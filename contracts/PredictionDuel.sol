// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DuelReputation} from "./DuelReputation.sol";

/// @title PredictionDuel
/// @notice Trustless peer-to-peer wagers on a yes/no outcome with
///         **asymmetric stakes**: the creator picks both their own stake
///         (`msg.value` at create-time) and the stake the opponent must
///         match (`opponentStake`). The favoured side typically risks more
///         to win less. The total pot is `creatorStake + opponentStake` and
///         is awarded to the side that the post-event consensus vote agrees
///         with.
/// @dev    Funds are paid out via the **pull-payment** pattern - settlement
///         only credits an internal balance and the recipient claims via
///         `withdraw()` - so a receiver that rejects ETH cannot brick the
///         duel for the counterparty. A linked `DuelReputation` SBT records
///         on-chain reputation for every settled duel.
contract PredictionDuel is ReentrancyGuard {
    // ------
    // Types
    // ------

    enum Outcome {
        NONE,
        YES,
        NO,
        INVALID
    }

    enum Status {
        CREATED,
        ACTIVE,
        VOTING,
        DISPUTED,
        SETTLED,
        CANCELLED
    }

    struct Duel {
        uint256 id;
        address creator;
        address opponent;
        uint256 creatorStake;
        uint256 opponentStake;
        uint256 minOpponentReputation; // 0 = no reputation gate
        uint64 voteDeadline;
        uint64 resolutionDeadline;
        Status status;
        Outcome creatorOutcome;
        Outcome opponentOutcome;
        Outcome creatorVote;
        Outcome opponentVote;
        string question;
    }

    // ------
    // Storage
    // ------

    /// @notice Linked soulbound reputation registry.
    DuelReputation public immutable reputation;

    uint256 public duelCounter;

    mapping(uint256 => Duel) private _duels;
    mapping(address => uint256[]) private _userDuels;

    /// @notice Pull-payment balances. Owners claim via `withdraw()`.
    mapping(address => uint256) public pendingWithdrawals;

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
        uint64 voteDeadline,
        uint64 resolutionDeadline,
        string question
    );
    event DuelAccepted(uint256 indexed id, address indexed opponent, Outcome opponentOutcome);
    event VoteSubmitted(uint256 indexed id, address indexed voter, Outcome vote);
    event DuelSettled(uint256 indexed id, address indexed winner, uint256 payout, Outcome consensus);
    event DuelRefunded(uint256 indexed id, uint256 creatorRefund, uint256 opponentRefund);
    event DuelCancelled(uint256 indexed id, address indexed creator, uint256 refund);
    event DuelDisputed(uint256 indexed id);
    event Withdrawn(address indexed account, uint256 amount);

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

    // ------
    // Constructor
    // ------

    constructor(address reputationAddr) {
        if (reputationAddr == address(0)) revert ZeroAddress();
        reputation = DuelReputation(reputationAddr);
    }

    // ------
    // External / public functions
    // ------

    /// @notice Create a duel with asymmetric stakes and an optional minimum
    ///         reputation requirement on the future opponent.
    /// @param  question The yes/no question being wagered on.
    /// @param  creatorOutcome The creator's bet side. Must be YES or NO.
    /// @param  opponentStake Exact ETH (in wei) the opponent must send to accept.
    /// @param  minOpponentReputation Minimum reputation score the opponent
    ///         must hold at accept-time (compared against int256). Pass 0
    ///         to allow any opponent including unscored newcomers.
    /// @param  voteDeadline Timestamp after which voting is closed.
    /// @param  resolutionDeadline Timestamp after which a single-voter
    ///         no-show settlement may be triggered. Must be > voteDeadline.
    /// @return id The newly assigned duel id.
    function createDuel(
        string calldata question,
        Outcome creatorOutcome,
        uint256 opponentStake,
        uint256 minOpponentReputation,
        uint64 voteDeadline,
        uint64 resolutionDeadline
    ) external payable nonReentrant returns (uint256 id) {
        if (msg.value == 0 || opponentStake == 0) revert ZeroStake();
        if (creatorOutcome != Outcome.YES && creatorOutcome != Outcome.NO) revert InvalidOutcome();
        if (bytes(question).length == 0) revert EmptyQuestion();
        if (voteDeadline <= block.timestamp) revert InvalidDeadlines();
        if (resolutionDeadline <= voteDeadline) revert InvalidDeadlines();

        unchecked {
            id = ++duelCounter;
        }

        Duel storage d = _duels[id];
        d.id = id;
        d.creator = msg.sender;
        d.creatorStake = msg.value;
        d.opponentStake = opponentStake;
        d.minOpponentReputation = minOpponentReputation;
        d.voteDeadline = voteDeadline;
        d.resolutionDeadline = resolutionDeadline;
        d.status = Status.CREATED;
        d.creatorOutcome = creatorOutcome;
        d.question = question;

        _userDuels[msg.sender].push(id);

        emit DuelCreated(
            id,
            msg.sender,
            creatorOutcome,
            msg.value,
            opponentStake,
            minOpponentReputation,
            voteDeadline,
            resolutionDeadline,
            question
        );
    }

    /// @notice Accept an open duel. The caller must (a) send exactly
    ///         `opponentStake` ETH and (b) have a reputation score that
    ///         meets the duel's `minOpponentReputation`.
    /// @param  id The duel id.
    function acceptDuel(uint256 id) external payable nonReentrant {
        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        if (d.status != Status.CREATED) revert NotCreatedStatus();
        if (msg.sender == d.creator) revert CreatorCannotAccept();
        if (msg.value != d.opponentStake) revert WrongStakeAmount();
        if (block.timestamp >= d.voteDeadline) revert VotingClosed();

        if (d.minOpponentReputation > 0) {
            int256 oppScore = reputation.reputationScore(msg.sender);
            // Negative-score users always fail a positive gate; otherwise
            // compare unsigned to avoid an int256 cast of a user-supplied
            // value that could wrap.
            if (oppScore < 0 || uint256(oppScore) < d.minOpponentReputation) {
                revert InsufficientReputation();
            }
        }

        Outcome opp = d.creatorOutcome == Outcome.YES ? Outcome.NO : Outcome.YES;

        d.opponent = msg.sender;
        d.opponentOutcome = opp;
        d.status = Status.ACTIVE;

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

        bool isCreator = msg.sender == d.creator;
        bool isOpponent = msg.sender == d.opponent;
        if (!isCreator && !isOpponent) revert NotParticipant();

        if (isCreator) {
            if (d.creatorVote != Outcome.NONE) revert AlreadyVoted();
            d.creatorVote = vote;
        } else {
            if (d.opponentVote != Outcome.NONE) revert AlreadyVoted();
            d.opponentVote = vote;
        }

        if (d.status == Status.ACTIVE) {
            d.status = Status.VOTING;
        }

        emit VoteSubmitted(id, msg.sender, vote);
    }

    /// @notice Settle a duel. Callable by anyone once `voteDeadline` has
    ///         passed. Updates reputation counters, credits the winner /
    ///         refundees, and emits the corresponding event.
    function settleDuel(uint256 id) external nonReentrant {
        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        if (d.status != Status.ACTIVE && d.status != Status.VOTING) revert AlreadySettled();
        if (block.timestamp < d.voteDeadline) revert VoteDeadlineNotReached();

        Outcome cv = d.creatorVote;
        Outcome ov = d.opponentVote;
        bool creatorVoted = cv != Outcome.NONE;
        bool opponentVoted = ov != Outcome.NONE;

        if (creatorVoted && opponentVoted) {
            if (cv == ov) {
                if (cv == Outcome.INVALID) {
                    // Clean refund — neither side is rewarded or punished.
                    _refundBoth(d, id);
                } else {
                    _payWinner(d, id, cv);
                }
            } else {
                // TODO Phase 5: invoke a dispute-resolution mechanism here.
                // Phase 5 should call reputation.recordDisputeWin(winner) and
                // reputation.recordDisputeLoss(loser) once a verdict is reached.
                d.status = Status.DISPUTED;
                emit DuelDisputed(id);
            }
            return;
        }

        // At least one side did not vote — wait out the resolution deadline.
        if (block.timestamp < d.resolutionDeadline) revert ResolutionDeadlineNotReached();

        if (!creatorVoted && !opponentVoted) {
            // Both sides no-show: refund stakes and penalise both.
            address creator = d.creator;
            address opponent = d.opponent;
            _refundBoth(d, id);
            reputation.recordNoShow(creator);
            reputation.recordNoShow(opponent);
        } else {
            // Single voter wins the full pot; the absentee is logged as a no-show.
            bool creatorIsWinner = creatorVoted;
            address winner = creatorIsWinner ? d.creator : d.opponent;
            address loser = creatorIsWinner ? d.opponent : d.creator;
            uint256 winnerStake = creatorIsWinner ? d.creatorStake : d.opponentStake;
            Outcome decidingVote = creatorIsWinner ? cv : ov;
            uint256 prize = d.creatorStake + d.opponentStake;
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

    /// @notice Withdraw all ETH credited to the caller (pull-payment claim).
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
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
        external
        view
        returns (Duel[] memory result)
    {
        if (limit == 0) revert InvalidPagination();

        Duel[] memory buf = new Duel[](limit);
        uint256 found;
        uint256 skipped;
        uint256 total = duelCounter;

        for (uint256 i = 1; i <= total && found < limit; ++i) {
            Duel storage d = _duels[i];
            if (_isActiveStatus(d.status)) {
                if (skipped < offset) {
                    unchecked { ++skipped; }
                } else {
                    buf[found] = d;
                    unchecked { ++found; }
                }
            }
        }

        result = new Duel[](found);
        for (uint256 i = 0; i < found; ++i) {
            result[i] = buf[i];
        }
    }

    function getUserDuels(address user) external view returns (uint256[] memory) {
        return _userDuels[user];
    }

    /// @notice Proxy to the reputation registry, returning both the raw
    ///         counters and the derived score.
    function getDuelistReputation(address user)
        external
        view
        returns (DuelReputation.Reputation memory rep, int256 score)
    {
        rep = reputation.getReputation(user);
        score = reputation.reputationScore(user);
    }

    // ------
    // Internal helpers
    // ------

    function _payWinner(Duel storage d, uint256 id, Outcome consensus) private {
        bool creatorIsWinner = (consensus == d.creatorOutcome);
        address winner = creatorIsWinner ? d.creator : d.opponent;
        address loser = creatorIsWinner ? d.opponent : d.creator;
        uint256 winnerStake = creatorIsWinner ? d.creatorStake : d.opponentStake;
        uint256 loserStake = creatorIsWinner ? d.opponentStake : d.creatorStake;
        uint256 prize = d.creatorStake + d.opponentStake;
        d.status = Status.SETTLED;
        emit DuelSettled(id, winner, prize, consensus);
        _credit(winner, prize);
        reputation.recordWin(winner, winnerStake);
        reputation.recordLoss(loser, loserStake);
    }

    function _refundBoth(Duel storage d, uint256 id) private {
        uint256 cAmt = d.creatorStake;
        uint256 oAmt = d.opponentStake;
        address creator = d.creator;
        address opponent = d.opponent;
        d.status = Status.SETTLED;
        emit DuelRefunded(id, cAmt, oAmt);
        _credit(creator, cAmt);
        _credit(opponent, oAmt);
    }

    function _credit(address to, uint256 amount) private {
        unchecked {
            pendingWithdrawals[to] += amount;
        }
    }

    function _isActiveStatus(Status s) private pure returns (bool) {
        return s != Status.SETTLED && s != Status.CANCELLED;
    }
}
