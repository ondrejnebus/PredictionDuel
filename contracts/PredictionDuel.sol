// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DuelReputation} from "./DuelReputation.sol";

/// @title PredictionDuel
/// @notice Trustless peer-to-peer wagers on a yes/no outcome with
///         **asymmetric stakes**: the creator picks both their own stake
///         (`msg.value` at create-time) and the stake the opponent must
///         match (`opponentStake`). The total pot is awarded to the side
///         that the post-event consensus vote agrees with.
/// @dev    Pull-payment pattern: settlement credits `pendingWithdrawals`;
///         recipients claim via `withdraw()`.
///
///         Phase 5 - Jury dispute resolution (Kleros / UMA OO inspired):
///         When creator and opponent disagree on the outcome, either party
///         calls `escalateToJury(id)` paying `DISPUTE_FEE`. A FIFO queue
///         of committed jurors (each staking `JUROR_STAKE`) is filled via
///         `claimDispute()`. Jurors vote in a `VOTING_PERIOD` window; the
///         majority verdict stands. Minority jurors lose `SLASH_AMOUNT`
///         (Schelling-point incentive). The round loser may appeal within
///         `APPEAL_WINDOW`, escalating to a larger panel at 3x / 9x fee.
///         Maximum three rounds (3-juror -> 5-juror -> 7-juror). After the
///         final round the duel is settled on-chain and reputation updated.
contract PredictionDuel is ReentrancyGuard {

    // ------
    // Core types
    // ------

    enum Outcome { NONE, YES, NO, INVALID }

    enum Status { CREATED, ACTIVE, VOTING, DISPUTED, SETTLED, CANCELLED }

    struct Duel {
        uint256 id;
        address creator;
        address opponent;
        uint256 creatorStake;
        uint256 opponentStake;
        uint256 minOpponentReputation;
        uint64  voteDeadline;
        uint64  resolutionDeadline;
        Status  status;
        Outcome creatorOutcome;
        Outcome opponentOutcome;
        Outcome creatorVote;
        Outcome opponentVote;
        string  question;
    }

    // ------
    // Phase-5 types
    // ------

    struct Juror {
        uint256 stake;
        uint256 lockedOnDispute; // duelId this juror is assigned to; 0 = free
        bool    isActive;
    }

    /// @dev Mappings inside a struct are allowed only in storage. Views that
    ///      need to expose dispute state use `getDisputeData()` which returns
    ///      individual fields rather than the whole struct.
    struct DisputeData {
        uint8   round;               // current round: 1, 2, or 3
        Outcome lastRoundOutcome;    // set after each round tally
        address[] selectedJurors;
        mapping(address => Outcome) jurorVotes;
        mapping(address => bool)    hasVoted;
        uint64  votingDeadline;
        uint64  appealDeadline;      // non-zero while appeal window is open
        address round1Loser;         // duel participant who lost round 1
        address round2Loser;
        uint256 feePool;             // accumulated fees distributed to majority jurors
        bool    initialized;
        bool    finalized;
    }

    // ------
    // Storage
    // ------

    DuelReputation public immutable reputation;

    uint256 public duelCounter;

    mapping(uint256 => Duel)      private _duels;
    mapping(address => uint256[]) private _userDuels;

    mapping(address => uint256) public pendingWithdrawals;

    // Phase-5 storage
    mapping(address => Juror)       private _jurors;
    mapping(uint256 => DisputeData) private _disputes;
    uint256[] private _disputeQueue;
    uint256   private _queueHead;

    // ------
    // Phase-5 constants
    // ------

    uint256 public constant DISPUTE_FEE    = 0.01 ether;
    uint256 public constant JUROR_STAKE    = 0.05 ether;
    uint256 public constant SLASH_AMOUNT   = 0.02 ether;
    uint256 public constant VOTING_PERIOD  = 48 hours;
    uint256 public constant APPEAL_WINDOW  = 24 hours;
    /// @notice Grace period after resolutionDeadline before a DISPUTED duel
    ///         that nobody escalated can be force-refunded by either party.
    uint256 public constant ESCALATION_GRACE = 7 days;
    uint8   private constant MAX_ROUNDS    = 3;

    // ------
    // Events
    // ------

    event DuelCreated(
        uint256 indexed id,
        address indexed creator,
        Outcome creatorOutcome,
        uint256 creatorStake,
        uint256 opponentStake,
        uint256 minOpponentReputation,
        uint64  voteDeadline,
        uint64  resolutionDeadline,
        string  question
    );
    event DuelAccepted(uint256 indexed id, address indexed opponent, Outcome opponentOutcome);
    event VoteSubmitted(uint256 indexed id, address indexed voter, Outcome vote);
    event DuelSettled(uint256 indexed id, address indexed winner, uint256 payout, Outcome consensus);
    event DuelRefunded(uint256 indexed id, uint256 creatorRefund, uint256 opponentRefund);
    event DuelCancelled(uint256 indexed id, address indexed creator, uint256 refund);
    event DuelDisputed(uint256 indexed id);
    event Withdrawn(address indexed account, uint256 amount);

    // Phase-5 events
    event JurorStaked(address indexed juror, uint256 amount);
    event JurorUnstaked(address indexed juror, uint256 amount);
    event DisputeEscalated(uint256 indexed duelId, uint8 round, address indexed initiator);
    event JurorClaimedDispute(uint256 indexed duelId, address indexed juror, uint8 round);
    event JurorVoted(uint256 indexed duelId, address indexed juror, Outcome vote);
    event RoundResolved(uint256 indexed duelId, uint8 round, Outcome majority, address indexed roundLoser);
    event JurorSlashed(address indexed juror, uint256 indexed duelId, uint256 amount);
    event DisputeFinalized(uint256 indexed duelId, Outcome verdict);
    event JurorRewarded(address indexed juror, uint256 indexed duelId, uint256 amount);

    // ------
    // Errors
    // ------

    error InvalidOutcome();
    error InvalidDeadlines();
    error ZeroStake();
    error EmptyQuestion();
    error DuelNotFound();
    error NotCreatedStatus();
    error NotActiveOrVoting();
    error CreatorCannotAccept();
    error WrongStakeAmount();
    error NotParticipant();
    error AlreadyVoted();
    error VotingClosed();
    error VoteDeadlineNotReached();
    error ResolutionDeadlineNotReached();
    error AlreadySettled();
    error OnlyCreator();
    error TransferFailed();
    error InvalidPagination();
    error NothingToWithdraw();
    error InsufficientReputation();
    error ZeroAddress();

    // Phase-5 errors
    error InsufficientJurorStake();
    error JurorAlreadyLocked();
    error NoDisputesInQueue();
    error NotEligibleJuror();
    error JurorIsParticipant();
    error DisputeNotInitialized();
    error VotingNotStarted();
    error VotingPeriodNotOver();
    error NotAJuror();
    error DisputeAlreadyFinalized();
    error NoAppealWindow();
    error AppealWindowStillOpen();
    error AppealWindowExpired();
    error NotRoundLoser();
    error WrongDisputeFee();
    error MaxRoundsReached();
    error DuelNotDisputed();
    error DisputeAlreadyInitialized();
    error EscalationGraceNotReached();

    // ------
    // Constructor
    // ------

    constructor(address reputationAddr) {
        if (reputationAddr == address(0)) revert ZeroAddress();
        reputation = DuelReputation(reputationAddr);
    }

    // ------
    // Core duel lifecycle
    // ------

    /// @notice Create a duel with asymmetric stakes.
    function createDuel(
        string calldata question,
        Outcome creatorOutcome,
        uint256 opponentStake,
        uint256 minOpponentReputation,
        uint64  voteDeadline,
        uint64  resolutionDeadline
    ) external payable nonReentrant returns (uint256 id) {
        if (msg.value == 0 || opponentStake == 0) revert ZeroStake();
        if (creatorOutcome != Outcome.YES && creatorOutcome != Outcome.NO) revert InvalidOutcome();
        if (bytes(question).length == 0) revert EmptyQuestion();
        if (voteDeadline <= block.timestamp) revert InvalidDeadlines();
        if (resolutionDeadline <= voteDeadline) revert InvalidDeadlines();

        unchecked { id = ++duelCounter; }

        Duel storage d = _duels[id];
        d.id                    = id;
        d.creator               = msg.sender;
        d.creatorStake          = msg.value;
        d.opponentStake         = opponentStake;
        d.minOpponentReputation = minOpponentReputation;
        d.voteDeadline          = voteDeadline;
        d.resolutionDeadline    = resolutionDeadline;
        d.status                = Status.CREATED;
        d.creatorOutcome        = creatorOutcome;
        d.question              = question;

        _userDuels[msg.sender].push(id);

        emit DuelCreated(
            id, msg.sender, creatorOutcome,
            msg.value, opponentStake, minOpponentReputation,
            voteDeadline, resolutionDeadline, question
        );
    }

    /// @notice Accept an open duel. Must send exactly `opponentStake` ETH.
    function acceptDuel(uint256 id) external payable nonReentrant {
        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        if (d.status != Status.CREATED) revert NotCreatedStatus();
        if (msg.sender == d.creator) revert CreatorCannotAccept();
        if (msg.value != d.opponentStake) revert WrongStakeAmount();
        if (block.timestamp >= d.voteDeadline) revert VotingClosed();

        if (d.minOpponentReputation > 0) {
            int256 oppScore = reputation.reputationScore(msg.sender);
            if (oppScore < 0 || uint256(oppScore) < d.minOpponentReputation) {
                revert InsufficientReputation();
            }
        }

        Outcome opp = d.creatorOutcome == Outcome.YES ? Outcome.NO : Outcome.YES;

        d.opponent        = msg.sender;
        d.opponentOutcome = opp;
        d.status          = Status.ACTIVE;

        _userDuels[msg.sender].push(id);
        emit DuelAccepted(id, msg.sender, opp);
    }

    /// @notice Submit your vote on what actually happened.
    function submitVote(uint256 id, Outcome vote) external {
        if (vote == Outcome.NONE) revert InvalidOutcome();

        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        if (d.status != Status.ACTIVE && d.status != Status.VOTING) revert NotActiveOrVoting();
        if (block.timestamp >= d.voteDeadline) revert VotingClosed();

        bool isCreator  = msg.sender == d.creator;
        bool isOpponent = msg.sender == d.opponent;
        if (!isCreator && !isOpponent) revert NotParticipant();

        if (isCreator) {
            if (d.creatorVote != Outcome.NONE) revert AlreadyVoted();
            d.creatorVote = vote;
        } else {
            if (d.opponentVote != Outcome.NONE) revert AlreadyVoted();
            d.opponentVote = vote;
        }

        if (d.status == Status.ACTIVE) d.status = Status.VOTING;

        emit VoteSubmitted(id, msg.sender, vote);
    }

    /// @notice Settle a duel once `voteDeadline` has passed.
    function settleDuel(uint256 id) external nonReentrant {
        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        if (d.status != Status.ACTIVE && d.status != Status.VOTING) revert AlreadySettled();
        if (block.timestamp < d.voteDeadline) revert VoteDeadlineNotReached();

        Outcome cv = d.creatorVote;
        Outcome ov = d.opponentVote;
        bool creatorVoted  = cv != Outcome.NONE;
        bool opponentVoted = ov != Outcome.NONE;

        if (creatorVoted && opponentVoted) {
            if (cv == ov) {
                if (cv == Outcome.INVALID) {
                    _refundBoth(d, id);
                } else {
                    _payWinner(d, id, cv);
                }
            } else {
                // Votes disagree - route to Phase-5 jury.
                // Either participant calls escalateToJury(id) to initiate.
                d.status = Status.DISPUTED;
                emit DuelDisputed(id);
            }
            return;
        }

        if (block.timestamp < d.resolutionDeadline) revert ResolutionDeadlineNotReached();

        if (!creatorVoted && !opponentVoted) {
            address creator  = d.creator;
            address opponent = d.opponent;
            _refundBoth(d, id);
            reputation.recordNoShow(creator);
            reputation.recordNoShow(opponent);
        } else {
            bool    creatorIsWinner = creatorVoted;
            address winner          = creatorIsWinner ? d.creator   : d.opponent;
            address loser           = creatorIsWinner ? d.opponent  : d.creator;
            uint256 winnerStake     = creatorIsWinner ? d.creatorStake : d.opponentStake;
            Outcome decidingVote    = creatorIsWinner ? cv : ov;
            uint256 prize           = d.creatorStake + d.opponentStake;
            d.status = Status.SETTLED;
            emit DuelSettled(id, winner, prize, decidingVote);
            _credit(winner, prize);
            reputation.recordWin(winner, winnerStake);
            reputation.recordNoShow(loser);
        }
    }

    /// @notice Cancel an open, unaccepted duel and recover the creator's stake.
    function cancelDuel(uint256 id) external nonReentrant {
        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        if (msg.sender != d.creator) revert OnlyCreator();
        if (d.status != Status.CREATED) revert NotCreatedStatus();

        uint256 refund = d.creatorStake;
        d.status = Status.CANCELLED;
        emit DuelCancelled(id, msg.sender, refund);
        _credit(msg.sender, refund);
    }

    /// @notice Withdraw all ETH credited to the caller.
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ------
    // Phase-5: Juror staking
    // ------

    /// @notice Deposit ETH to join the juror pool.
    function stakeAsJuror() external payable nonReentrant {
        if (msg.value == 0) revert ZeroStake();
        Juror storage j = _jurors[msg.sender];
        unchecked { j.stake += msg.value; }
        if (j.stake >= JUROR_STAKE) j.isActive = true;
        emit JurorStaked(msg.sender, msg.value);
    }

    /// @notice Withdraw juror stake. Reverts if the caller is assigned to a live dispute.
    function unstakeAsJuror(uint256 amount) external nonReentrant {
        Juror storage j = _jurors[msg.sender];
        if (j.lockedOnDispute != 0) revert JurorAlreadyLocked();
        if (j.stake < amount) revert InsufficientJurorStake();
        unchecked { j.stake -= amount; }
        if (j.stake < JUROR_STAKE) j.isActive = false;
        _credit(msg.sender, amount);
        emit JurorUnstaked(msg.sender, amount);
    }

    // ------
    // Phase-5: Dispute initiation
    // ------

    /// @notice Initiate jury escalation for a DISPUTED duel.
    /// @dev    Callable by anyone willing to pay `DISPUTE_FEE`. The fee enters
    ///         the dispute fee pool and is distributed to majority jurors upon
    ///         finalization.
    function escalateToJury(uint256 duelId) external payable nonReentrant {
        Duel storage d = _duels[duelId];
        if (d.creator == address(0)) revert DuelNotFound();
        if (d.status != Status.DISPUTED) revert DuelNotDisputed();
        DisputeData storage dd = _disputes[duelId];
        if (dd.initialized) revert DisputeAlreadyInitialized();
        if (msg.value != DISPUTE_FEE) revert WrongDisputeFee();

        dd.initialized = true;
        dd.round       = 1;
        dd.feePool     = msg.value;
        _disputeQueue.push(duelId);
        emit DisputeEscalated(duelId, 1, msg.sender);
    }

    /// @notice Refund both stakes for a duel that has been DISPUTED for longer
    ///         than `ESCALATION_GRACE` past `resolutionDeadline` without anyone
    ///         escalating to a jury. Anyone can call this so a stuck duel
    ///         never permanently locks funds.
    function cancelStaleDispute(uint256 duelId) external nonReentrant {
        Duel storage d = _duels[duelId];
        if (d.creator == address(0)) revert DuelNotFound();
        if (d.status != Status.DISPUTED) revert DuelNotDisputed();
        if (_disputes[duelId].initialized) revert DisputeAlreadyInitialized();
        if (block.timestamp < uint256(d.resolutionDeadline) + ESCALATION_GRACE) {
            revert EscalationGraceNotReached();
        }
        _refundBoth(d, duelId);
    }

    // ------
    // Phase-5: Jury panel assembly
    // ------

    /// @notice Claim the front dispute from the FIFO queue.
    ///         Once the required panel size for the current round is reached,
    ///         the queue advances and the voting window opens.
    /// @dev    No `selectedJurors` membership check is needed: a juror
    ///         already on the panel has `lockedOnDispute != 0`, and that
    ///         earlier branch reverts with `JurorAlreadyLocked` first.
    function claimDispute() external nonReentrant {
        if (_queueHead >= _disputeQueue.length) revert NoDisputesInQueue();

        uint256 duelId  = _disputeQueue[_queueHead];
        Duel storage d  = _duels[duelId];
        DisputeData storage dd = _disputes[duelId];

        Juror storage j = _jurors[msg.sender];
        if (!j.isActive || j.stake < JUROR_STAKE) revert NotEligibleJuror();
        if (j.lockedOnDispute != 0) revert JurorAlreadyLocked();
        if (msg.sender == d.creator || msg.sender == d.opponent) revert JurorIsParticipant();

        j.lockedOnDispute = duelId;
        dd.selectedJurors.push(msg.sender);
        emit JurorClaimedDispute(duelId, msg.sender, dd.round);

        if (uint8(dd.selectedJurors.length) == _jurorCountForRound(dd.round)) {
            unchecked { _queueHead++; }
            dd.votingDeadline = uint64(block.timestamp + VOTING_PERIOD);
        }
    }

    // ------
    // Phase-5: Voting
    // ------

    /// @notice Cast a jury vote. Only callable by assigned jurors during the
    ///         voting window.
    function juryVote(uint256 duelId, Outcome vote) external {
        if (vote == Outcome.NONE) revert InvalidOutcome();
        DisputeData storage dd = _disputes[duelId];
        if (dd.votingDeadline == 0) revert VotingNotStarted();
        if (block.timestamp >= dd.votingDeadline) revert VotingClosed();
        if (dd.hasVoted[msg.sender]) revert AlreadyVoted();

        bool isJuror;
        uint256 len = dd.selectedJurors.length;
        for (uint256 i; i < len; ) {
            if (dd.selectedJurors[i] == msg.sender) { isJuror = true; break; }
            unchecked { ++i; }
        }
        if (!isJuror) revert NotAJuror();

        dd.jurorVotes[msg.sender] = vote;
        dd.hasVoted[msg.sender]   = true;
        emit JurorVoted(duelId, msg.sender, vote);
    }

    // ------
    // Phase-5: Round finalization & appeal
    // ------

    /// @notice Tally votes after the voting period, slash minority jurors, and
    ///         either open the appeal window or finalize the dispute.
    ///         Also callable after an appeal window expires to lock in the verdict.
    function finalizeJuryRound(uint256 duelId) external nonReentrant {
        DisputeData storage dd = _disputes[duelId];
        if (!dd.initialized)  revert DisputeNotInitialized();
        if (dd.finalized)     revert DisputeAlreadyFinalized();

        // If appeal window is open, check whether it has expired.
        if (dd.appealDeadline != 0) {
            if (block.timestamp <= dd.appealDeadline) revert AppealWindowStillOpen();
            _finalizeDispute(duelId, dd.lastRoundOutcome);
            return;
        }

        if (dd.votingDeadline == 0) revert VotingNotStarted();
        if (block.timestamp < dd.votingDeadline) revert VotingPeriodNotOver();

        // Tally votes
        uint256 yesVotes;
        uint256 noVotes;
        uint256 panelLen = dd.selectedJurors.length;
        for (uint256 i; i < panelLen; ) {
            Outcome v = dd.jurorVotes[dd.selectedJurors[i]];
            if (v == Outcome.YES)     { unchecked { ++yesVotes; } }
            else if (v == Outcome.NO) { unchecked { ++noVotes;  } }
            unchecked { ++i; }
        }

        Outcome majority;
        if      (yesVotes > noVotes) majority = Outcome.YES;
        else if (noVotes > yesVotes) majority = Outcome.NO;
        else                         majority = Outcome.INVALID; // tie

        // Slash minority jurors and free all panel members
        uint256 slashAccum;
        for (uint256 i; i < panelLen; ) {
            address jurorAddr = dd.selectedJurors[i];
            Juror storage jj  = _jurors[jurorAddr];
            if (dd.jurorVotes[jurorAddr] != majority) {
                uint256 slash = jj.stake < SLASH_AMOUNT ? jj.stake : SLASH_AMOUNT;
                unchecked { jj.stake -= slash; slashAccum += slash; }
                if (jj.stake < JUROR_STAKE) jj.isActive = false;
                emit JurorSlashed(jurorAddr, duelId, slash);
            }
            jj.lockedOnDispute = 0;
            unchecked { ++i; }
        }
        unchecked { dd.feePool += slashAccum; }

        // Identify the round loser: the duel participant whose bet disagrees
        // with the majority verdict.
        Duel storage d = _duels[duelId];
        address roundLoser;
        if (majority != Outcome.INVALID) {
            bool creatorWins = (majority == d.creatorOutcome);
            roundLoser = creatorWins ? d.opponent : d.creator;
        }

        if      (dd.round == 1) dd.round1Loser = roundLoser;
        else if (dd.round == 2) dd.round2Loser = roundLoser;

        dd.lastRoundOutcome = majority;
        emit RoundResolved(duelId, dd.round, majority, roundLoser);

        if (dd.round >= MAX_ROUNDS || majority == Outcome.INVALID) {
            _finalizeDispute(duelId, majority);
        } else {
            dd.appealDeadline = uint64(block.timestamp + APPEAL_WINDOW);
        }
    }

    /// @notice The round loser appeals within the appeal window, escalating to
    ///         the next jury tier. Fee: 3x DISPUTE_FEE for round 2, 9x for round 3.
    function appealDispute(uint256 duelId) external payable nonReentrant {
        DisputeData storage dd = _disputes[duelId];
        if (dd.finalized)        revert DisputeAlreadyFinalized();
        if (dd.appealDeadline == 0) revert NoAppealWindow();
        if (block.timestamp > dd.appealDeadline) revert AppealWindowExpired();
        if (dd.round >= MAX_ROUNDS) revert MaxRoundsReached();

        address loser = (dd.round == 1) ? dd.round1Loser : dd.round2Loser;
        if (msg.sender != loser) revert NotRoundLoser();

        uint8   nextRound = dd.round + 1;
        uint256 appealFee = _feeForRound(nextRound);
        if (msg.value != appealFee) revert WrongDisputeFee();

        // Clear previous panel data
        uint256 len = dd.selectedJurors.length;
        for (uint256 i; i < len; ) {
            address jurorAddr = dd.selectedJurors[i];
            delete dd.jurorVotes[jurorAddr];
            delete dd.hasVoted[jurorAddr];
            unchecked { ++i; }
        }
        delete dd.selectedJurors;

        dd.round         = nextRound;
        dd.votingDeadline  = 0;
        dd.appealDeadline  = 0;
        unchecked { dd.feePool += msg.value; }

        _disputeQueue.push(duelId);
        emit DisputeEscalated(duelId, nextRound, msg.sender);
    }

    // ------
    // Views
    // ------

    function getDuel(uint256 id) external view returns (Duel memory) {
        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        return d;
    }

    function getActiveDuels(uint256 offset, uint256 limit)
        external view returns (Duel[] memory result)
    {
        if (limit == 0) revert InvalidPagination();
        Duel[] memory buf = new Duel[](limit);
        uint256 found;
        uint256 skipped;
        uint256 total = duelCounter;

        for (uint256 i = 1; i <= total && found < limit; ++i) {
            Duel storage d = _duels[i];
            if (_isActiveStatus(d.status)) {
                if (skipped < offset) { unchecked { ++skipped; } }
                else { buf[found] = d; unchecked { ++found; } }
            }
        }

        result = new Duel[](found);
        for (uint256 i; i < found; ++i) result[i] = buf[i];
    }

    function getUserDuels(address user) external view returns (uint256[] memory) {
        return _userDuels[user];
    }

    function getDuelistReputation(address user)
        external view
        returns (DuelReputation.Reputation memory rep, int256 score)
    {
        rep   = reputation.getReputation(user);
        score = reputation.reputationScore(user);
    }

    // Phase-5 views

    function getDisputeQueueLength() external view returns (uint256) {
        uint256 len = _disputeQueue.length;
        return len > _queueHead ? len - _queueHead : 0;
    }

    function getNextDispute() external view returns (uint256) {
        if (_queueHead >= _disputeQueue.length) revert NoDisputesInQueue();
        return _disputeQueue[_queueHead];
    }

    function getDisputeData(uint256 duelId) external view returns (
        uint8   round,
        Outcome lastRoundOutcome,
        address[] memory selectedJurors,
        uint64  votingDeadline,
        uint64  appealDeadline,
        address round1Loser,
        address round2Loser,
        uint256 feePool,
        bool    initialized,
        bool    finalized
    ) {
        DisputeData storage dd = _disputes[duelId];
        return (
            dd.round, dd.lastRoundOutcome, dd.selectedJurors,
            dd.votingDeadline, dd.appealDeadline,
            dd.round1Loser, dd.round2Loser,
            dd.feePool, dd.initialized, dd.finalized
        );
    }

    function getJurorInfo(address juror) external view returns (
        uint256 stake,
        uint256 lockedOnDispute,
        bool    isActive
    ) {
        Juror storage j = _jurors[juror];
        return (j.stake, j.lockedOnDispute, j.isActive);
    }

    function getActiveDisputes(uint256 offset, uint256 limit)
        external view returns (uint256[] memory result)
    {
        if (limit == 0) revert InvalidPagination();
        uint256[] memory buf = new uint256[](limit);
        uint256 found;
        uint256 skipped;
        uint256 total = duelCounter;

        for (uint256 i = 1; i <= total && found < limit; ++i) {
            DisputeData storage dd = _disputes[i];
            if (dd.initialized && !dd.finalized) {
                if (skipped < offset) { unchecked { ++skipped; } }
                else { buf[found] = i; unchecked { ++found; } }
            }
        }

        result = new uint256[](found);
        for (uint256 i; i < found; ++i) result[i] = buf[i];
    }

    // ------
    // Internal helpers
    // ------

    function _payWinner(Duel storage d, uint256 id, Outcome consensus) private {
        bool    creatorIsWinner = (consensus == d.creatorOutcome);
        address winner          = creatorIsWinner ? d.creator  : d.opponent;
        address loser           = creatorIsWinner ? d.opponent : d.creator;
        uint256 winnerStake     = creatorIsWinner ? d.creatorStake  : d.opponentStake;
        uint256 loserStake      = creatorIsWinner ? d.opponentStake : d.creatorStake;
        uint256 prize           = d.creatorStake + d.opponentStake;
        d.status = Status.SETTLED;
        emit DuelSettled(id, winner, prize, consensus);
        _credit(winner, prize);
        reputation.recordWin(winner, winnerStake);
        reputation.recordLoss(loser, loserStake);
    }

    function _refundBoth(Duel storage d, uint256 id) private {
        uint256 cAmt     = d.creatorStake;
        uint256 oAmt     = d.opponentStake;
        address creator  = d.creator;
        address opponent = d.opponent;
        d.status = Status.SETTLED;
        emit DuelRefunded(id, cAmt, oAmt);
        _credit(creator,  cAmt);
        _credit(opponent, oAmt);
    }

    /// @dev Settle the underlying duel and distribute juror rewards.
    ///      If verdict == INVALID, both stakes are refunded **and the dispute
    ///      fee pool is split 50/50 between the participants** so escalation
    ///      fees aren't lost when the jury can't reach a clear answer.
    function _finalizeDispute(uint256 duelId, Outcome verdict) private {
        DisputeData storage dd = _disputes[duelId];
        Duel storage d         = _duels[duelId];
        dd.finalized    = true;
        dd.appealDeadline = 0;

        if (verdict == Outcome.INVALID) {
            d.status = Status.SETTLED;
            emit DuelRefunded(duelId, d.creatorStake, d.opponentStake);
            _credit(d.creator,  d.creatorStake);
            _credit(d.opponent, d.opponentStake);
            // Refund the dispute fee pool 50/50 so escalators aren't punished
            // for an inconclusive jury. Any odd-wei remainder favours the opponent.
            uint256 pool = dd.feePool;
            if (pool > 0) {
                uint256 half = pool / 2;
                _credit(d.creator,  half);
                _credit(d.opponent, pool - half);
            }
        } else {
            bool    creatorWins = (verdict == d.creatorOutcome);
            address winner      = creatorWins ? d.creator  : d.opponent;
            address loser       = creatorWins ? d.opponent : d.creator;
            uint256 winnerStake = creatorWins ? d.creatorStake  : d.opponentStake;
            uint256 loserStake  = creatorWins ? d.opponentStake : d.creatorStake;
            uint256 prize       = d.creatorStake + d.opponentStake;
            d.status = Status.SETTLED;
            emit DuelSettled(duelId, winner, prize, verdict);
            _credit(winner, prize);
            reputation.recordWin(winner, winnerStake);
            reputation.recordLoss(loser, loserStake);
            reputation.recordDisputeWin(winner);
            reputation.recordDisputeLoss(loser);
        }

        // Reward majority jurors of the final round from the fee pool.
        // INVALID verdicts return early above (fee pool is split 50/50 to
        // participants there), so this branch only handles YES / NO.
        if (verdict != Outcome.INVALID && dd.feePool > 0) {
            uint256 panelLen = dd.selectedJurors.length;
            uint256 majorityCount;
            for (uint256 i; i < panelLen; ) {
                if (dd.jurorVotes[dd.selectedJurors[i]] == verdict) { unchecked { ++majorityCount; } }
                unchecked { ++i; }
            }
            if (majorityCount > 0) {
                uint256 reward = dd.feePool / majorityCount;
                for (uint256 i; i < panelLen; ) {
                    address jurorAddr = dd.selectedJurors[i];
                    if (dd.jurorVotes[jurorAddr] == verdict) {
                        _credit(jurorAddr, reward);
                        emit JurorRewarded(jurorAddr, duelId, reward);
                    }
                    unchecked { ++i; }
                }
                // Integer-division remainder stays in contract (negligible dust).
            }
        }

        emit DisputeFinalized(duelId, verdict);
    }

    function _credit(address to, uint256 amount) private {
        unchecked { pendingWithdrawals[to] += amount; }
    }

    function _isActiveStatus(Status s) private pure returns (bool) {
        return s != Status.SETTLED && s != Status.CANCELLED;
    }

    function _jurorCountForRound(uint8 round) private pure returns (uint8) {
        if (round == 1) return 3;
        if (round == 2) return 5;
        return 7;
    }

    function _feeForRound(uint8 round) private pure returns (uint256) {
        if (round == 2) return 3 * DISPUTE_FEE;
        if (round == 3) return 9 * DISPUTE_FEE;
        return DISPUTE_FEE;
    }
}
