import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const Outcome = { NONE: 0, YES: 1, NO: 2, INVALID: 3 } as const;
const Status = {
  CREATED: 0,
  ACTIVE: 1,
  VOTING: 2,
  DISPUTED: 3,
  SETTLED: 4,
  CANCELLED: 5,
} as const;

const QUESTION = "Will BTC be below $50k on Dec 31 2026?";
const CREATOR_STAKE = ethers.parseEther("0.8");
const OPPONENT_STAKE = ethers.parseEther("0.2");

async function deployFixture() {
  const [deployer, alice, bob, charlie] = await ethers.getSigners();
  const contract = await ethers.deployContract("PredictionDuel");
  await contract.waitForDeployment();

  const now = await time.latest();
  const voteDeadline = now + 3600;
  const resolutionDeadline = now + 7200;

  return {
    contract,
    deployer,
    alice,
    bob,
    charlie,
    voteDeadline,
    resolutionDeadline,
    creatorStake: CREATOR_STAKE,
    opponentStake: OPPONENT_STAKE,
  };
}

async function activeDuelFixture() {
  const base = await deployFixture();
  const { contract, alice, bob, voteDeadline, resolutionDeadline, creatorStake, opponentStake } = base;

  await contract
    .connect(alice)
    .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
      value: creatorStake,
    });
  await contract.connect(bob).acceptDuel(1, { value: opponentStake });

  return { ...base, duelId: 1n };
}

describe("PredictionDuel", function () {
  // ------
  // Happy path
  // ------

  describe("Deployment & creation", function () {
    it("1. Should deploy and have correct initial state", async function () {
      const { contract } = await loadFixture(deployFixture);

      expect(await contract.duelCounter()).to.equal(0n);
      await expect(contract.getDuel(1)).to.be.revertedWithCustomError(contract, "DuelNotFound");
      await expect(contract.getActiveDuels(0, 0)).to.be.revertedWithCustomError(
        contract,
        "InvalidPagination",
      );
    });

    it("2. Should create a duel with correct parameters", async function () {
      const { contract, alice, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      const contractAddr = await contract.getAddress();

      const tx = contract
        .connect(alice)
        .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
          value: creatorStake,
        });

      await expect(tx)
        .to.emit(contract, "DuelCreated")
        .withArgs(
          1n,
          alice.address,
          Outcome.YES,
          creatorStake,
          opponentStake,
          voteDeadline,
          resolutionDeadline,
          QUESTION,
        );
      await expect(tx).to.changeEtherBalances(ethers,
        [alice, contractAddr],
        [-creatorStake, creatorStake],
      );

      expect(await contract.duelCounter()).to.equal(1n);

      const d = await contract.getDuel(1);
      expect(d.id).to.equal(1n);
      expect(d.creator).to.equal(alice.address);
      expect(d.creatorStake).to.equal(creatorStake);
      expect(d.opponentStake).to.equal(opponentStake);
      expect(d.creatorOutcome).to.equal(Outcome.YES);
      expect(d.status).to.equal(Status.CREATED);
      expect(d.question).to.equal(QUESTION);

      expect(await contract.getUserDuels(alice.address)).to.deep.equal([1n]);
    });
  });

  describe("Acceptance", function () {
    it("3. Should let opponent accept duel and lock both stakes", async function () {
      const { contract, alice, bob, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      await contract
        .connect(alice)
        .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
          value: creatorStake,
        });

      const contractAddr = await contract.getAddress();

      const tx = contract.connect(bob).acceptDuel(1, { value: opponentStake });
      await expect(tx)
        .to.emit(contract, "DuelAccepted")
        .withArgs(1n, bob.address, Outcome.NO);
      await expect(tx).to.changeEtherBalances(ethers,
        [bob, contractAddr],
        [-opponentStake, opponentStake],
      );

      const d = await contract.getDuel(1);
      expect(d.opponent).to.equal(bob.address);
      expect(d.opponentOutcome).to.equal(Outcome.NO);
      expect(d.status).to.equal(Status.ACTIVE);

      expect(await contract.getUserDuels(bob.address)).to.deep.equal([1n]);
    });
  });

  describe("Voting", function () {
    it("4. Should accept votes from both players and update status", async function () {
      const { contract, alice, bob } = await loadFixture(activeDuelFixture);

      await expect(contract.connect(alice).submitVote(1, Outcome.YES))
        .to.emit(contract, "VoteSubmitted")
        .withArgs(1n, alice.address, Outcome.YES);

      let d = await contract.getDuel(1);
      expect(d.status).to.equal(Status.VOTING);
      expect(d.creatorVote).to.equal(Outcome.YES);
      expect(d.opponentVote).to.equal(Outcome.NONE);

      await expect(contract.connect(bob).submitVote(1, Outcome.NO))
        .to.emit(contract, "VoteSubmitted")
        .withArgs(1n, bob.address, Outcome.NO);

      d = await contract.getDuel(1);
      expect(d.opponentVote).to.equal(Outcome.NO);
      expect(d.status).to.equal(Status.VOTING);
    });
  });

  describe("Settlement", function () {
    it("5. Should pay creator the full pot when both vote YES and creator bet YES", async function () {
      const { contract, alice, bob, voteDeadline, creatorStake, opponentStake } =
        await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.YES);
      await contract.connect(bob).submitVote(1, Outcome.YES);

      await time.increaseTo(voteDeadline);

      const totalPot = creatorStake + opponentStake;

      await expect(contract.settleDuel(1))
        .to.emit(contract, "DuelSettled")
        .withArgs(1n, alice.address, totalPot, Outcome.YES);

      const d = await contract.getDuel(1);
      expect(d.status).to.equal(Status.SETTLED);
      expect(await contract.pendingWithdrawals(alice.address)).to.equal(totalPot);
      expect(await contract.pendingWithdrawals(bob.address)).to.equal(0n);

      const contractAddr = await contract.getAddress();

      const wTx = contract.connect(alice).withdraw();
      await expect(wTx).to.emit(contract, "Withdrawn").withArgs(alice.address, totalPot);
      await expect(wTx).to.changeEtherBalances(ethers,
        [alice, contractAddr],
        [totalPot, -totalPot],
      );

      expect(await contract.pendingWithdrawals(alice.address)).to.equal(0n);
    });

    it("6. Should pay opponent when both vote NO and opponent bet NO", async function () {
      const { contract, alice, bob, voteDeadline, creatorStake, opponentStake } =
        await loadFixture(activeDuelFixture);

      // Alice's creator outcome was YES -> Bob's opponent outcome is NO.
      await contract.connect(alice).submitVote(1, Outcome.NO);
      await contract.connect(bob).submitVote(1, Outcome.NO);

      await time.increaseTo(voteDeadline);

      const totalPot = creatorStake + opponentStake;

      await expect(contract.settleDuel(1))
        .to.emit(contract, "DuelSettled")
        .withArgs(1n, bob.address, totalPot, Outcome.NO);

      expect(await contract.pendingWithdrawals(bob.address)).to.equal(totalPot);
      expect(await contract.pendingWithdrawals(alice.address)).to.equal(0n);

      await expect(contract.connect(bob).withdraw()).to.changeEtherBalance(ethers,bob, totalPot);
    });

    it("7. Should refund both when both vote INVALID", async function () {
      const { contract, alice, bob, voteDeadline, creatorStake, opponentStake } =
        await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.INVALID);
      await contract.connect(bob).submitVote(1, Outcome.INVALID);

      await time.increaseTo(voteDeadline);

      await expect(contract.settleDuel(1))
        .to.emit(contract, "DuelRefunded")
        .withArgs(1n, creatorStake, opponentStake);

      expect(await contract.pendingWithdrawals(alice.address)).to.equal(creatorStake);
      expect(await contract.pendingWithdrawals(bob.address)).to.equal(opponentStake);

      await expect(contract.connect(alice).withdraw()).to.changeEtherBalance(ethers,alice, creatorStake);
      await expect(contract.connect(bob).withdraw()).to.changeEtherBalance(ethers,bob, opponentStake);
    });
  });

  // ------
  // Edge cases / reverts
  // ------

  describe("Edge cases", function () {
    it("8. Should revert when creator stakes 0 ETH", async function () {
      const { contract, alice, voteDeadline, resolutionDeadline, opponentStake } =
        await loadFixture(deployFixture);

      await expect(
        contract
          .connect(alice)
          .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
            value: 0,
          }),
      ).to.be.revertedWithCustomError(contract, "ZeroStake");
    });

    it("9. Should revert when opponent sends wrong stake amount", async function () {
      const { contract, alice, bob, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      await contract
        .connect(alice)
        .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
          value: creatorStake,
        });

      await expect(
        contract.connect(bob).acceptDuel(1, { value: opponentStake + 1n }),
      ).to.be.revertedWithCustomError(contract, "WrongStakeAmount");

      await expect(
        contract.connect(bob).acceptDuel(1, { value: opponentStake - 1n }),
      ).to.be.revertedWithCustomError(contract, "WrongStakeAmount");
    });

    it("10. Should revert when same address tries to accept own duel", async function () {
      const { contract, alice, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      await contract
        .connect(alice)
        .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
          value: creatorStake,
        });

      await expect(
        contract.connect(alice).acceptDuel(1, { value: opponentStake }),
      ).to.be.revertedWithCustomError(contract, "CreatorCannotAccept");
    });

    it("11. Should revert when accepting an already-accepted duel", async function () {
      const { contract, charlie, opponentStake } = await loadFixture(activeDuelFixture);

      await expect(
        contract.connect(charlie).acceptDuel(1, { value: opponentStake }),
      ).to.be.revertedWithCustomError(contract, "NotCreatedStatus");
    });

    it("12. Should revert when voting before duel is accepted", async function () {
      const { contract, alice, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      await contract
        .connect(alice)
        .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
          value: creatorStake,
        });

      await expect(
        contract.connect(alice).submitVote(1, Outcome.YES),
      ).to.be.revertedWithCustomError(contract, "NotActiveOrVoting");
    });

    it("13. Should revert when voting after voteDeadline", async function () {
      const { contract, alice, voteDeadline } = await loadFixture(activeDuelFixture);

      await time.increaseTo(voteDeadline);

      await expect(
        contract.connect(alice).submitVote(1, Outcome.YES),
      ).to.be.revertedWithCustomError(contract, "VotingClosed");
    });

    it("14. Should revert when settling before voteDeadline", async function () {
      const { contract } = await loadFixture(activeDuelFixture);

      await expect(contract.settleDuel(1)).to.be.revertedWithCustomError(
        contract,
        "VoteDeadlineNotReached",
      );
    });

    it("15. Should revert when same player tries to vote twice", async function () {
      const { contract, alice } = await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.YES);

      await expect(
        contract.connect(alice).submitVote(1, Outcome.NO),
      ).to.be.revertedWithCustomError(contract, "AlreadyVoted");
    });

    it("16. Should revert when non-participant tries to vote", async function () {
      const { contract, charlie } = await loadFixture(activeDuelFixture);

      await expect(
        contract.connect(charlie).submitVote(1, Outcome.YES),
      ).to.be.revertedWithCustomError(contract, "NotParticipant");
    });
  });

  // ------
  // No-show / timeout
  // ------

  describe("No-show / timeout", function () {
    it("17. Should let one party win by default if other doesn't vote and resolutionDeadline passes", async function () {
      const { contract, alice, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(activeDuelFixture);

      // Only alice votes; bob no-shows entirely.
      await contract.connect(alice).submitVote(1, Outcome.YES);

      // Settle attempt before resolutionDeadline must fail because bob
      // didn't vote and we haven't crossed resolutionDeadline yet.
      // Using a margin (-10) because time.increaseTo + the next tx pushes
      // the actual block timestamp slightly forward.
      await time.increaseTo(resolutionDeadline - 10);
      await expect(contract.settleDuel(1)).to.be.revertedWithCustomError(
        contract,
        "ResolutionDeadlineNotReached",
      );

      await time.increaseTo(resolutionDeadline);

      const totalPot = creatorStake + opponentStake;

      await expect(contract.settleDuel(1))
        .to.emit(contract, "DuelSettled")
        .withArgs(1n, alice.address, totalPot, Outcome.YES);

      expect(await contract.pendingWithdrawals(alice.address)).to.equal(totalPot);
      await expect(contract.connect(alice).withdraw()).to.changeEtherBalance(ethers,alice, totalPot);
    });

    it("18. Should refund both if neither votes after resolutionDeadline", async function () {
      const { contract, alice, bob, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(activeDuelFixture);

      await time.increaseTo(resolutionDeadline);

      await expect(contract.settleDuel(1))
        .to.emit(contract, "DuelRefunded")
        .withArgs(1n, creatorStake, opponentStake);

      expect(await contract.pendingWithdrawals(alice.address)).to.equal(creatorStake);
      expect(await contract.pendingWithdrawals(bob.address)).to.equal(opponentStake);
    });

    it("19. Should let creator cancel an unaccepted duel and recover stake", async function () {
      const { contract, alice, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      await contract
        .connect(alice)
        .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
          value: creatorStake,
        });

      await expect(contract.connect(alice).cancelDuel(1))
        .to.emit(contract, "DuelCancelled")
        .withArgs(1n, alice.address, creatorStake);

      const d = await contract.getDuel(1);
      expect(d.status).to.equal(Status.CANCELLED);
      expect(await contract.pendingWithdrawals(alice.address)).to.equal(creatorStake);

      await expect(contract.connect(alice).withdraw()).to.changeEtherBalance(ethers,alice, creatorStake);
    });

    it("20. Should revert when creator tries to cancel after acceptance", async function () {
      const { contract, alice } = await loadFixture(activeDuelFixture);

      await expect(contract.connect(alice).cancelDuel(1)).to.be.revertedWithCustomError(
        contract,
        "NotCreatedStatus",
      );
    });
  });

  // ------
  // Disagreement -> DISPUTED
  // ------

  describe("Disagreement", function () {
    it("21. Should mark duel as DISPUTED when players vote different non-INVALID outcomes", async function () {
      const { contract, alice, bob, voteDeadline } = await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.YES);
      await contract.connect(bob).submitVote(1, Outcome.NO);

      await time.increaseTo(voteDeadline);

      await expect(contract.settleDuel(1)).to.emit(contract, "DuelDisputed").withArgs(1n);

      const d = await contract.getDuel(1);
      expect(d.status).to.equal(Status.DISPUTED);

      // No funds released yet; Phase 5 will handle DISPUTED resolution.
      expect(await contract.pendingWithdrawals(alice.address)).to.equal(0n);
      expect(await contract.pendingWithdrawals(bob.address)).to.equal(0n);

      // settleDuel cannot be re-run on a DISPUTED duel.
      await expect(contract.settleDuel(1)).to.be.revertedWithCustomError(
        contract,
        "AlreadySettled",
      );
    });
  });

  // ------
  // Security
  // ------

  describe("Security", function () {
    it("22. Should be protected against reentrancy on withdraw()", async function () {
      const { contract, alice, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      const Attacker = await ethers.getContractFactory("ReentrantAttacker");
      const attacker = await Attacker.deploy(await contract.getAddress(), { value: opponentStake });
      await attacker.waitForDeployment();
      const attackerAddr = await attacker.getAddress();

      // Alice (creator, YES) vs Attacker (opponent, NO).
      await contract
        .connect(alice)
        .createDuel(QUESTION, Outcome.YES, opponentStake, voteDeadline, resolutionDeadline, {
          value: creatorStake,
        });

      await attacker.joinDuel(1, opponentStake);

      // Both vote NO so the attacker wins the pot and gets credited.
      await contract.connect(alice).submitVote(1, Outcome.NO);
      await attacker.vote(1, Outcome.NO);

      await time.increaseTo(voteDeadline);
      await contract.settleDuel(1);

      const totalPot = creatorStake + opponentStake;
      expect(await contract.pendingWithdrawals(attackerAddr)).to.equal(totalPot);

      // Reentry attempt: receive() inside attacker calls withdraw() again.
      // ReentrancyGuard reverts the inner call -> outer call() returns false ->
      // outer withdraw reverts with TransferFailed. Funds remain credited.
      await expect(attacker.attack()).to.be.revertedWithCustomError(contract, "TransferFailed");

      expect(await contract.pendingWithdrawals(attackerAddr)).to.equal(totalPot);
    });

    it("23. Should not allow double-claiming of winnings", async function () {
      const { contract, alice, bob, voteDeadline, creatorStake, opponentStake } =
        await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.YES);
      await contract.connect(bob).submitVote(1, Outcome.YES);
      await time.increaseTo(voteDeadline);
      await contract.settleDuel(1);

      const totalPot = creatorStake + opponentStake;

      const contractAddr = await contract.getAddress();
      await expect(contract.connect(alice).withdraw()).to.changeEtherBalance(ethers,alice, totalPot);

      // After the first withdraw, the contract is empty and pendingWithdrawals
      // is zeroed; a second call must revert with NothingToWithdraw.
      expect(await contract.pendingWithdrawals(alice.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(contractAddr)).to.equal(0n);

      await expect(contract.connect(alice).withdraw()).to.be.revertedWithCustomError(
        contract,
        "NothingToWithdraw",
      );
    });
  });
});
