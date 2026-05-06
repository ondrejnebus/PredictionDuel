// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {PredictionDuel} from "../PredictionDuel.sol";

/// @notice Test-only contract used to verify that PredictionDuel.withdraw()
///         is protected against reentrancy. Funded at construction time so
///         it can stake into a duel; on `attack()` it calls `withdraw()` and
///         re-enters from `receive()`.
/// @dev    NOT for production. Only included so coverage tests can exercise
///         the ReentrancyGuard / CEI boundary.
contract ReentrantAttacker {
    PredictionDuel public immutable target;
    bool public attacking;

    constructor(PredictionDuel _target) payable {
        target = _target;
    }

    function joinDuel(uint256 id, uint256 stake) external {
        target.acceptDuel{value: stake}(id);
    }

    function vote(uint256 id, PredictionDuel.Outcome v) external {
        target.submitVote(id, v);
    }

    function attack() external {
        attacking = true;
        target.withdraw();
        attacking = false;
    }

    receive() external payable {
        if (attacking) {
            // Re-enter - ReentrancyGuard must block this. The inner call's
            // revert will cause this receive() to revert, which in turn
            // makes the outer call() return false -> withdraw reverts with
            // TransferFailed.
            target.withdraw();
        }
    }
}