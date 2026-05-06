// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PredictionDuel
/// @notice Trustless peer-to-peer wagers on a yes/no outcome with
///         **asymmetric stakes**: the creator picks both their own stake
///         (`msg.value` at create-time) and the stake the opponent must
///         match (`opponentStake`). The favoured side typically risks more
///         to win less. The total pot is `creatorStake + opponentStake` and
///         is awarded to the side that the post-event consensus vote agrees
///         with.
/// @dev    Phase 1: dispute resolution and reputation are intentionally out
///         of scope. Funds are paid out via the **pull-payment** pattern -
///         settlement only credits an internal balance and the recipient
///         claims via `withdraw()` - so a receiver that rejects ETH cannot
///         brick the duel for the counterparty.
contract PredictionDuel is ReentrancyGuard {
    // ------
    // Types
    // ------

    /// @notice Possible bet sides and vote values.
    /// @dev NONE is the unset default; YES/NO are the bettable sides;
    ///      INVALID lets both sides agree the event was unresolvable so that
    ///      stakes are refunded.
    enum Outcome {
        NONE,
        YES,
        NO,
        INVALID
    }

    /// @notice Lifecycle of a duel.
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
        uint256 creatorStake;       // creator's locked ETH (paid at create)
        uint256 opponentStake;      // ETH opponent must send at accept
        uint64 voteDeadline;        // votes must arrive before this timestamp
        uint64 resolutionDeadline;  // single-voter no-show settlement unlocks here
        Status status;
        Outcome creatorOutcome;     // creator's bet side (YES or NO)
        Outcome opponentOutcome;    // opposite of creatorOutcome (set on accept)
        Outcome creatorVote;        // creator's reported outcome (NONE = not voted)
        Outcome opponentVote;       // opponent's reported outcome
        string question;
    }

    // ------
    // Storage
    // ------

    /// @notice Total number of duels ever created. Also the highest assigned id.
    uint256 public duelCounter;

    mapping(uint256 => Duel) private _duels;
    mapping(address => uint256[]) private _userDuels;

    /// @notice ETH credited to each address by settlements, refunds, and
    ///         cancellations. Owners must call `withdraw()` to claim. This
    ///         is the pull-payment pattern: settlement never fails because
    ///         a participant cannot receive ETH.
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

    // ------
    // External / public functions
    // ------

    /// @notice Create a duel with asymmetric stakes.
    /// @dev    The creator pays `msg.value` (= `creatorStake`) up-front and
    ///         declares the opponent's required stake separately, so the
    ///         odds are encoded in the stake ratio (e.g. 80/20 means the
    ///         creator risks 80 to win an extra 20, the opponent risks 20
    ///         to win an extra 80). Both stakes must be > 0.
    /// @param  question The yes/no question being wagered on.
    /// @param  creatorOutcome The creator's bet side. Must be YES or NO.
    /// @param  opponentStake Exact ETH (in wei) the opponent will need to
    ///         send at accept-time. Must be > 0.
    /// @param  voteDeadline Timestamp after which voting is closed.
    /// @param  resolutionDeadline Timestamp after which a single-voter
    ///         no-show settlement may be triggered. Must be > voteDeadline.
    /// @return id The newly assigned duel id.
    function createDuel(
        string calldata question,
        Outcome creatorOutcome,
        uint256 opponentStake,
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
            voteDeadline,
            resolutionDeadline,
            question
        );
    }

    /// @notice Accept an open duel by sending exactly `opponentStake` ETH.
    ///         Caller is locked into the side opposite to the creator.
    /// @param  id The duel id.
    function acceptDuel(uint256 id) external payable nonReentrant {
        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        if (d.status != Status.CREATED) revert NotCreatedStatus();
        if (msg.sender == d.creator) revert CreatorCannotAccept();
        if (msg.value != d.opponentStake) revert WrongStakeAmount();
        if (block.timestamp >= d.voteDeadline) revert VotingClosed();

        Outcome opp = d.creatorOutcome == Outcome.YES ? Outcome.NO : Outcome.YES;

        d.opponent = msg.sender;
        d.opponentOutcome = opp;
        d.status = Status.ACTIVE;

        _userDuels[msg.sender].push(id);

        emit DuelAccepted(id, msg.sender, opp);
    }

    /// @notice Submit your vote on what actually happened.
    /// @dev    Each participant may vote once. Voting is allowed up to (but
    ///         not including) `voteDeadline`. INVALID is allowed and signals
    ///         "the event is unresolvable"; if both vote INVALID, both are
    ///         refunded at settlement.
    /// @param  id The duel id.
    /// @param  vote YES, NO, or INVALID.
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

    /// @notice Settle a duel. Callable by anyone once the vote deadline has
    ///         passed. Funds are credited to `pendingWithdrawals`; recipients
    ///         claim via `withdraw()`.
    /// @param  id The duel id.
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
                    _refundBoth(d, id);
                } else {
                    _payWinner(d, id, cv);
                }
            } else {
                // TODO Phase 5: route to dispute resolution. For now we just
                // mark the duel DISPUTED and leave the funds locked.
                d.status = Status.DISPUTED;
                emit DuelDisputed(id);
            }
            return;
        }

        // At least one side did not vote: wait for the resolution deadline.
        if (block.timestamp < d.resolutionDeadline) revert ResolutionDeadlineNotReached();

        if (!creatorVoted && !opponentVoted) {
            _refundBoth(d, id);
        } else {
            address winner = creatorVoted ? d.creator : d.opponent;
            Outcome decidingVote = creatorVoted ? cv : ov;
            uint256 prize = d.creatorStake + d.opponentStake;
            d.status = Status.SETTLED;
            emit DuelSettled(id, winner, prize, decidingVote);
            _credit(winner, prize);
        }
    }

    /// @notice Cancel an open, unaccepted duel and recover the creator's stake.
    /// @dev    Stake is credited to `pendingWithdrawals[creator]`; claim via `withdraw()`.
    /// @param  id The duel id.
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
    /// @dev    Pull-payment claim. CEI is enforced (balance is zeroed before
    ///         the external call) and `nonReentrant` adds belt-and-braces. If
    ///         the recipient's `receive()` reverts, the whole call reverts and
    ///         the credit is preserved for a later retry.
    /// @return amount Wei sent to the caller.
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

    /// @notice Fetch a duel by id.
    /// @param  id The duel id.
    /// @return The full duel struct.
    function getDuel(uint256 id) external view returns (Duel memory) {
        Duel storage d = _duels[id];
        if (d.creator == address(0)) revert DuelNotFound();
        return d;
    }

    /// @notice Paginated view of all duels not yet SETTLED or CANCELLED,
    ///         ordered by id ascending.
    /// @dev    `offset` and `limit` are applied over the *filtered* list of
    ///         active duels.
    /// @param  offset Number of active duels to skip.
    /// @param  limit  Maximum number of duels to return. Must be > 0.
    /// @return result The active duels in the requested page.
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

    /// @notice All duel ids that `user` has either created or accepted.
    /// @param  user The address to query.
    /// @return Array of duel ids in chronological order of involvement.
    function getUserDuels(address user) external view returns (uint256[] memory) {
        return _userDuels[user];
    }

    // ------
    // Internal helpers
    // ------

    function _payWinner(Duel storage d, uint256 id, Outcome consensus) private {
        address winner = (consensus == d.creatorOutcome) ? d.creator : d.opponent;
        uint256 prize = d.creatorStake + d.opponentStake;
        d.status = Status.SETTLED;
        emit DuelSettled(id, winner, prize, consensus);
        _credit(winner, prize);
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
        // Overflow is impossible here because the sum of all credits cannot
        // exceed the total ETH supply, which is far below uint256 max.
        unchecked {
            pendingWithdrawals[to] += amount;
        }
    }

    function _isActiveStatus(Status s) private pure returns (bool) {
        return s != Status.SETTLED && s != Status.CANCELLED;
    }
}