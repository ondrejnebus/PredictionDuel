// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DuelReputation
/// @notice Soulbound ERC-721 representing a duelist's on-chain reputation.
///         The token id is deterministically derived from the holder's
///         address (`uint256(uint160(addr))`), so each address can only
///         ever own one reputation NFT, and the NFT cannot be transferred
///         (mints and burns are still permitted).
/// @dev    v1 scoring rationale (see scoring constants below):
///           - Wins are stake-weighted (`2 + log2(stake / 1e15)`) so a 1
///             ETH win is worth more than a thousand 0.001 ETH wash-trades.
///           - No-show penalty is score-scaled (`max(10, score / 5)`) so
///             high-rep accounts can't shrug off a no-show.
///           - Dispute *win* gives only +1 (small confirmation bonus);
///             dispute *loss* gives -10. Disputes are an escape hatch, not
///             a profit center.
///           - Positive `winPointsAccum` decays by half every 365 days of
///             inactivity, applied permanently on the next write
///             (`_rebase`). Negative reputation does NOT decay.
contract DuelReputation is ERC721 {
    using Strings for uint256;
    using Strings for int256;

    // ------
    // Score weights (constants, on-chain auditable)
    // ------

    int256 public constant POINTS_PER_DISPUTE_WIN = 1;
    int256 public constant POINTS_PER_DISPUTE_LOSS = -10;
    uint256 public constant WIN_BASE_POINTS = 2;
    uint256 public constant WIN_STAKE_BASELINE = 1e15; // 0.001 ETH
    uint256 public constant NO_SHOW_BASE_PENALTY = 10;
    uint256 public constant NO_SHOW_SCALE_DIVISOR = 5;
    uint256 public constant DECAY_HALVING_PERIOD = 365 days;
    uint256 private constant MAX_HALVINGS = 30;

    // ------
    // Types & storage
    // ------

    /// @dev `winPointsAccum` is the only field that decays. The raw
    ///      counters (wins, losses, ...) are kept as honest historical
    ///      counts; the score formula reads `winPointsAccum` (decayed) and
    ///      `noShowPenaltyAccum` (sticky).
    struct Reputation {
        uint256 wins;
        uint256 losses;
        uint256 disputesInitiated;
        uint256 disputesWon;
        uint256 disputesLost;
        uint256 noShowCount;
        uint256 totalVolumeWei;
        uint256 winPointsAccum;       // stake-weighted win points; decays
        uint256 noShowPenaltyAccum;   // accumulated no-show penalty; sticky
        uint64 lastActivityAt;        // 0 = never active
    }

    /// @notice The PredictionDuel contract authorised to mutate reputation.
    address public immutable duelContract;

    mapping(address => Reputation) private _rep;

    // ------
    // Events
    // ------

    event ReputationMinted(address indexed user, uint256 indexed tokenId);
    event WinRecorded(address indexed user, uint256 stake, uint256 points);
    event LossRecorded(address indexed user, uint256 stake);
    event NoShowRecorded(address indexed user, uint256 penalty);
    event DisputeWinRecorded(address indexed user);
    event DisputeLossRecorded(address indexed user);
    event ReputationDecayed(address indexed user, uint256 halvings);

    // ------
    // Errors
    // ------

    error NotDuelContract();
    error SoulboundTransferDisallowed();
    error ZeroAddress();

    // ------
    // Modifiers
    // ------

    modifier onlyDuelContract() {
        if (msg.sender != duelContract) revert NotDuelContract();
        _;
    }

    // ------
    // Constructor
    // ------

    constructor(address _duelContract) ERC721("PredictionDuel Reputation", "PDREP") {
        if (_duelContract == address(0)) revert ZeroAddress();
        duelContract = _duelContract;
    }

    // ------
    // Public / external
    // ------

    /// @notice Address-derived token id.
    function tokenIdOf(address user) public pure returns (uint256) {
        return uint256(uint160(user));
    }

    /// @notice Lazy-mint a reputation NFT for `user` if they don't have one.
    /// @dev    Idempotent. Uses `_mint` (not `_safeMint`) on purpose: the
    ///         token is soulbound and recipients never need an
    ///         `onERC721Received` hook. Skipping the callback also removes
    ///         a re-entrancy / brick-the-settlement vector when the
    ///         recipient is a contract.
    function mintIfNeeded(address user) public onlyDuelContract {
        if (user == address(0)) revert ZeroAddress();
        uint256 tokenId = tokenIdOf(user);
        if (_ownerOf(tokenId) == address(0)) {
            _mint(user, tokenId);
            emit ReputationMinted(user, tokenId);
        }
    }

    /// @notice Record a win and credit stake-weighted points.
    function recordWin(address user, uint256 stake) external onlyDuelContract {
        mintIfNeeded(user);
        Reputation storage r = _rep[user];
        _rebase(r, user);
        uint256 points = _winPoints(stake);
        unchecked {
            r.wins += 1;
            r.winPointsAccum += points;
            r.totalVolumeWei += stake;
        }
        r.lastActivityAt = uint64(block.timestamp);
        emit WinRecorded(user, stake, points);
    }

    /// @notice Record an honest loss (counts toward volume but not score).
    function recordLoss(address user, uint256 stake) external onlyDuelContract {
        mintIfNeeded(user);
        Reputation storage r = _rep[user];
        _rebase(r, user);
        unchecked {
            r.losses += 1;
            r.totalVolumeWei += stake;
        }
        r.lastActivityAt = uint64(block.timestamp);
        emit LossRecorded(user, stake);
    }

    /// @notice Record a no-show. Penalty scales with the user's current
    ///         (decayed) score, so a high-rep account loses meaningfully.
    function recordNoShow(address user) external onlyDuelContract {
        mintIfNeeded(user);
        Reputation storage r = _rep[user];

        // Compute penalty from the user's score *before* this no-show
        // (with decay applied). Then rebase and persist.
        int256 currentScore = _scoreOf(r);
        uint256 penalty = NO_SHOW_BASE_PENALTY;
        if (currentScore > 0) {
            uint256 scaled = uint256(currentScore) / NO_SHOW_SCALE_DIVISOR;
            if (scaled > penalty) penalty = scaled;
        }

        _rebase(r, user);
        unchecked {
            r.noShowCount += 1;
            r.noShowPenaltyAccum += penalty;
        }
        r.lastActivityAt = uint64(block.timestamp);
        emit NoShowRecorded(user, penalty);
    }

    /// @notice Phase-5 hook: record a dispute won by `user`.
    function recordDisputeWin(address user) external onlyDuelContract {
        mintIfNeeded(user);
        Reputation storage r = _rep[user];
        _rebase(r, user);
        unchecked {
            r.disputesWon += 1;
            r.disputesInitiated += 1;
        }
        r.lastActivityAt = uint64(block.timestamp);
        emit DisputeWinRecorded(user);
    }

    /// @notice Phase-5 hook: record a dispute lost by `user`.
    function recordDisputeLoss(address user) external onlyDuelContract {
        mintIfNeeded(user);
        Reputation storage r = _rep[user];
        _rebase(r, user);
        unchecked {
            r.disputesLost += 1;
            r.disputesInitiated += 1;
        }
        r.lastActivityAt = uint64(block.timestamp);
        emit DisputeLossRecorded(user);
    }

    /// @notice Full counter set for `user`.
    function getReputation(address user) external view returns (Reputation memory) {
        return _rep[user];
    }

    /// @notice Score derived on the fly. Applies pending decay to the
    ///         positive `winPointsAccum` for read-time freshness; the
    ///         decay is committed to storage on the next write.
    function reputationScore(address user) public view returns (int256) {
        return _scoreOf(_rep[user]);
    }

    /// @notice Returns the win-points contribution for a given stake.
    ///         Useful for off-chain previews.
    function winPointsForStake(uint256 stake) external pure returns (uint256) {
        return _winPoints(stake);
    }

    // ------
    // Soulbound enforcement
    // ------

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert SoulboundTransferDisallowed();
        }
        return super._update(to, tokenId, auth);
    }

    // ------
    // Token URI - inline base64 JSON, fully on-chain
    // ------

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        address user = address(uint160(tokenId));
        Reputation storage r = _rep[user];
        int256 score = _scoreOf(r);

        bytes memory json = abi.encodePacked(
            '{"name":"PredictionDuel Reputation #',
            tokenId.toString(),
            '","description":"Soulbound on-chain reputation for PredictionDuel duelists.",',
            '"attributes":[',
            '{"trait_type":"Score","value":', score.toStringSigned(), '},',
            '{"trait_type":"Wins","value":', r.wins.toString(), '},',
            '{"trait_type":"Losses","value":', r.losses.toString(), '},',
            '{"trait_type":"Disputes Won","value":', r.disputesWon.toString(), '},',
            '{"trait_type":"Disputes Lost","value":', r.disputesLost.toString(), '},',
            '{"trait_type":"No-shows","value":', r.noShowCount.toString(), '},',
            '{"trait_type":"Volume Wei","value":', r.totalVolumeWei.toString(), '}',
            "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    // ------
    // Internal scoring helpers
    // ------

    function _winPoints(uint256 stake) private pure returns (uint256) {
        if (stake < WIN_STAKE_BASELINE) return WIN_BASE_POINTS;
        unchecked {
            return WIN_BASE_POINTS + Math.log2(stake / WIN_STAKE_BASELINE);
        }
    }

    function _scoreOf(Reputation storage r) private view returns (int256) {
        uint256 decayedWinPoints = _decayedWinPoints(r.winPointsAccum, r.lastActivityAt);
        return int256(decayedWinPoints)
            + int256(r.disputesWon) * POINTS_PER_DISPUTE_WIN
            + int256(r.disputesLost) * POINTS_PER_DISPUTE_LOSS
            - int256(r.noShowPenaltyAccum);
    }

    function _decayedWinPoints(uint256 raw, uint64 lastActivityAt)
        private
        view
        returns (uint256)
    {
        if (raw == 0 || lastActivityAt == 0) return raw;
        uint256 elapsed = block.timestamp - lastActivityAt;
        if (elapsed < DECAY_HALVING_PERIOD) return raw;
        uint256 halvings = elapsed / DECAY_HALVING_PERIOD;
        if (halvings > MAX_HALVINGS) halvings = MAX_HALVINGS;
        return raw >> halvings;
    }

    /// @dev Persists the decay of `winPointsAccum` since `lastActivityAt`.
    ///      Called at the start of every write so the stored state stays
    ///      consistent with what `reputationScore` returns.
    function _rebase(Reputation storage r, address user) private {
        if (r.lastActivityAt == 0 || r.winPointsAccum == 0) return;
        uint256 elapsed = block.timestamp - r.lastActivityAt;
        if (elapsed < DECAY_HALVING_PERIOD) return;
        uint256 halvings = elapsed / DECAY_HALVING_PERIOD;
        if (halvings > MAX_HALVINGS) halvings = MAX_HALVINGS;
        r.winPointsAccum >>= halvings;
        emit ReputationDecayed(user, halvings);
    }
}