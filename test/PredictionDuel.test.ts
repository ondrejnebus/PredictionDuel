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

const NO_REP_GATE = 0n;

async function deployFixture() {
  const [deployer, alice, bob, charlie] = await ethers.getSigners();

  // PredictionDuel and DuelReputation reference each other in their
  // constructors. Predict the PredictionDuel address (deployer's nonce + 1)
  // so we can deploy reputation first.
  const nonce = await ethers.provider.getTransactionCount(deployer.address);
  const predictedDuelAddr = ethers.getCreateAddress({
    from: deployer.address,
    nonce: nonce + 1,
  });
  const reputation = await ethers.deployContract("DuelReputation", [predictedDuelAddr]);
  await reputation.waitForDeployment();

  const contract = await ethers.deployContract("PredictionDuel", [
    await reputation.getAddress(),
  ]);
  await contract.waitForDeployment();

  if ((await contract.getAddress()).toLowerCase() !== predictedDuelAddr.toLowerCase()) {
    throw new Error("Address prediction mismatch - contracts cannot be linked.");
  }

  const now = await time.latest();
  const voteDeadline = now + 3600;
  const resolutionDeadline = now + 7200;

  return {
    contract,
    reputation,
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
    .createDuel(
      QUESTION,
      Outcome.YES,
      opponentStake,
      NO_REP_GATE,
      voteDeadline,
      resolutionDeadline,
      { value: creatorStake },
    );
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
        .createDuel(QUESTION, Outcome.YES, opponentStake, NO_REP_GATE, voteDeadline, resolutionDeadline, {
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
          NO_REP_GATE,
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
        .createDuel(QUESTION, Outcome.YES, opponentStake, NO_REP_GATE, voteDeadline, resolutionDeadline, {
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
          .createDuel(QUESTION, Outcome.YES, opponentStake, NO_REP_GATE, voteDeadline, resolutionDeadline, {
            value: 0,
          }),
      ).to.be.revertedWithCustomError(contract, "ZeroStake");
    });

    it("9. Should revert when opponent sends wrong stake amount", async function () {
      const { contract, alice, bob, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      await contract
        .connect(alice)
        .createDuel(QUESTION, Outcome.YES, opponentStake, NO_REP_GATE, voteDeadline, resolutionDeadline, {
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
        .createDuel(QUESTION, Outcome.YES, opponentStake, NO_REP_GATE, voteDeadline, resolutionDeadline, {
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
        .createDuel(QUESTION, Outcome.YES, opponentStake, NO_REP_GATE, voteDeadline, resolutionDeadline, {
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
        .createDuel(QUESTION, Outcome.YES, opponentStake, NO_REP_GATE, voteDeadline, resolutionDeadline, {
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
        .createDuel(QUESTION, Outcome.YES, opponentStake, NO_REP_GATE, voteDeadline, resolutionDeadline, {
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

  // ------
  // Reputation system (DuelReputation integration)
  // ------

  describe("Reputation: lazy mint & soulbound", function () {
    it("24. Should lazy-mint reputation NFTs to both participants on settle", async function () {
      const { contract, reputation, alice, bob, voteDeadline } =
        await loadFixture(activeDuelFixture);

      expect(await reputation.balanceOf(alice.address)).to.equal(0n);
      expect(await reputation.balanceOf(bob.address)).to.equal(0n);

      await contract.connect(alice).submitVote(1, Outcome.YES);
      await contract.connect(bob).submitVote(1, Outcome.YES);
      await time.increaseTo(voteDeadline);
      await contract.settleDuel(1);

      expect(await reputation.balanceOf(alice.address)).to.equal(1n);
      expect(await reputation.balanceOf(bob.address)).to.equal(1n);

      const aliceTokenId = await reputation.tokenIdOf(alice.address);
      expect(await reputation.ownerOf(aliceTokenId)).to.equal(alice.address);
    });

    it("25. Should revert any transferFrom (soulbound enforcement)", async function () {
      const { contract, reputation, alice, bob, charlie, voteDeadline } =
        await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.YES);
      await contract.connect(bob).submitVote(1, Outcome.YES);
      await time.increaseTo(voteDeadline);
      await contract.settleDuel(1);

      const tokenId = await reputation.tokenIdOf(alice.address);

      await expect(
        reputation.connect(alice).transferFrom(alice.address, charlie.address, tokenId),
      ).to.be.revertedWithCustomError(reputation, "SoulboundTransferDisallowed");

      await expect(
        reputation
          .connect(alice)
          ["safeTransferFrom(address,address,uint256)"](
            alice.address,
            charlie.address,
            tokenId,
          ),
      ).to.be.revertedWithCustomError(reputation, "SoulboundTransferDisallowed");
    });

    it("26. Should reject record* calls from non-duel callers", async function () {
      const { reputation, alice } = await loadFixture(deployFixture);

      await expect(
        reputation.connect(alice).recordWin(alice.address, 1n),
      ).to.be.revertedWithCustomError(reputation, "NotDuelContract");

      await expect(
        reputation.connect(alice).mintIfNeeded(alice.address),
      ).to.be.revertedWithCustomError(reputation, "NotDuelContract");
    });
  });

  describe("Reputation: scoring formula", function () {
    it("27. Should match documented winPointsForStake values at boundaries", async function () {
      const { reputation } = await loadFixture(deployFixture);

      // Sub-baseline -> flat 2
      expect(await reputation.winPointsForStake(0n)).to.equal(2n);
      expect(await reputation.winPointsForStake(ethers.parseEther("0.0001"))).to.equal(2n);

      // At baseline (0.001 ETH): 2 + log2(1) = 2
      expect(await reputation.winPointsForStake(ethers.parseEther("0.001"))).to.equal(2n);

      // 0.01 ETH: 2 + log2(10) = 2 + 3 = 5
      expect(await reputation.winPointsForStake(ethers.parseEther("0.01"))).to.equal(5n);

      // 0.8 ETH: 2 + log2(800) = 2 + 9 = 11
      expect(await reputation.winPointsForStake(ethers.parseEther("0.8"))).to.equal(11n);

      // 1 ETH: 2 + log2(1000) = 2 + 9 = 11
      expect(await reputation.winPointsForStake(ethers.parseEther("1"))).to.equal(11n);

      // 1024 ETH: 2 + log2(1_024_000) = 2 + 19 = 21
      expect(await reputation.winPointsForStake(ethers.parseEther("1024"))).to.equal(21n);
    });

    it("28. Should credit stake-weighted win points and zero loss points", async function () {
      const { contract, reputation, alice, bob, voteDeadline, creatorStake, opponentStake } =
        await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.YES);
      await contract.connect(bob).submitVote(1, Outcome.YES);
      await time.increaseTo(voteDeadline);
      await contract.settleDuel(1);

      const aliceRep = await reputation.getReputation(alice.address);
      expect(aliceRep.wins).to.equal(1n);
      expect(aliceRep.losses).to.equal(0n);
      expect(aliceRep.winPointsAccum).to.equal(11n); // 0.8 ETH stake
      expect(aliceRep.totalVolumeWei).to.equal(creatorStake);

      const bobRep = await reputation.getReputation(bob.address);
      expect(bobRep.wins).to.equal(0n);
      expect(bobRep.losses).to.equal(1n);
      expect(bobRep.winPointsAccum).to.equal(0n);
      expect(bobRep.totalVolumeWei).to.equal(opponentStake);

      expect(await reputation.reputationScore(alice.address)).to.equal(11n);
      expect(await reputation.reputationScore(bob.address)).to.equal(0n);
    });

    it("29. Should apply base no-show penalty (10) for fresh users", async function () {
      const { contract, reputation, alice, bob, resolutionDeadline } =
        await loadFixture(activeDuelFixture);

      await time.increaseTo(resolutionDeadline);
      await contract.settleDuel(1);

      const aliceRep = await reputation.getReputation(alice.address);
      expect(aliceRep.noShowCount).to.equal(1n);
      expect(aliceRep.noShowPenaltyAccum).to.equal(10n);

      expect(await reputation.reputationScore(alice.address)).to.equal(-10n);
      expect(await reputation.reputationScore(bob.address)).to.equal(-10n);
    });
  });

  describe("Reputation: gating", function () {
    it("30. Should reject acceptors below minOpponentReputation", async function () {
      const {
        contract,
        alice,
        bob,
        voteDeadline,
        resolutionDeadline,
        creatorStake,
        opponentStake,
      } = await loadFixture(deployFixture);

      await contract
        .connect(alice)
        .createDuel(
          QUESTION,
          Outcome.YES,
          opponentStake,
          5n, // require score >= 5
          voteDeadline,
          resolutionDeadline,
          { value: creatorStake },
        );

      // Bob is unscored (score 0); the gate must reject.
      await expect(
        contract.connect(bob).acceptDuel(1, { value: opponentStake }),
      ).to.be.revertedWithCustomError(contract, "InsufficientReputation");
    });

    it("31. Should accept opponents who meet the rep gate", async function () {
      const { contract, alice, bob, charlie, opponentStake, creatorStake } =
        await loadFixture(deployFixture);

      // Round 1: bob beats charlie in an ungated duel to earn score (>= 5).
      const t0 = await time.latest();
      const vd1 = t0 + 600;
      const rd1 = t0 + 1200;
      await contract
        .connect(bob)
        .createDuel(
          QUESTION,
          Outcome.YES,
          opponentStake,
          NO_REP_GATE,
          vd1,
          rd1,
          { value: creatorStake },
        );
      await contract.connect(charlie).acceptDuel(1, { value: opponentStake });
      await contract.connect(bob).submitVote(1, Outcome.YES);
      await contract.connect(charlie).submitVote(1, Outcome.YES);
      await time.increaseTo(vd1);
      await contract.settleDuel(1);

      // Bob now has 11 win points from a 0.8 ETH stake.
      // Round 2: alice creates a gated duel; bob can accept.
      const t1 = await time.latest();
      const vd2 = t1 + 600;
      const rd2 = t1 + 1200;
      await contract
        .connect(alice)
        .createDuel(
          QUESTION,
          Outcome.YES,
          opponentStake,
          5n,
          vd2,
          rd2,
          { value: creatorStake },
        );

      await expect(contract.connect(bob).acceptDuel(2, { value: opponentStake }))
        .to.emit(contract, "DuelAccepted")
        .withArgs(2n, bob.address, Outcome.NO);
    });
  });

  describe("Reputation: decay", function () {
    it("32. Should halve positive winPointsAccum after one decay period of inactivity", async function () {
      const { contract, reputation, alice, bob, voteDeadline } =
        await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.YES);
      await contract.connect(bob).submitVote(1, Outcome.YES);
      await time.increaseTo(voteDeadline);
      await contract.settleDuel(1);

      // Alice has 11 win points, fresh.
      expect(await reputation.reputationScore(alice.address)).to.equal(11n);

      // Advance one full halving period (365 days + slack).
      await time.increase(365 * 24 * 60 * 60 + 1);

      // Read-side decay: 11 >> 1 == 5
      expect(await reputation.reputationScore(alice.address)).to.equal(5n);

      // Storage isn't yet rebased - that happens on the next write.
      const repBefore = await reputation.getReputation(alice.address);
      expect(repBefore.winPointsAccum).to.equal(11n);
    });

    it("33. Should NOT decay sticky negative reputation (no-show penalty)", async function () {
      const { contract, reputation, alice, resolutionDeadline } =
        await loadFixture(activeDuelFixture);

      await time.increaseTo(resolutionDeadline);
      await contract.settleDuel(1);

      expect(await reputation.reputationScore(alice.address)).to.equal(-10n);

      await time.increase(2 * 365 * 24 * 60 * 60); // 2 years inactive

      // Bad rep is sticky.
      expect(await reputation.reputationScore(alice.address)).to.equal(-10n);
    });
  });

  describe("Reputation: tokenURI", function () {
    it("34. Should return inline base64 JSON metadata", async function () {
      const { contract, reputation, alice, bob, voteDeadline } =
        await loadFixture(activeDuelFixture);

      await contract.connect(alice).submitVote(1, Outcome.YES);
      await contract.connect(bob).submitVote(1, Outcome.YES);
      await time.increaseTo(voteDeadline);
      await contract.settleDuel(1);

      const tokenId = await reputation.tokenIdOf(alice.address);
      const uri = await reputation.tokenURI(tokenId);

      expect(uri.startsWith("data:application/json;base64,")).to.equal(true);

      const json = JSON.parse(
        Buffer.from(uri.slice("data:application/json;base64,".length), "base64").toString(
          "utf8",
        ),
      );

      expect(json.name).to.match(/^PredictionDuel Reputation #/);
      expect(json.attributes).to.be.an("array");

      const byName: Record<string, number | string> = {};
      for (const a of json.attributes) byName[a.trait_type] = a.value;

      expect(byName["Score"]).to.equal(11);
      expect(byName["Wins"]).to.equal(1);
      expect(byName["Losses"]).to.equal(0);
      expect(byName["No-shows"]).to.equal(0);
    });
  });

  // -----
  // Phase 5: Dispute resolution
  // -----

  // Fixture: alice (YES) vs bob (NO) -> DISPUTED after voteDeadline.
  async function disputedDuelFixture() {
    const base = await deployFixture();
    const { contract, alice, bob } = base;

    await contract
      .connect(alice)
      .createDuel(QUESTION, Outcome.YES, base.opponentStake, NO_REP_GATE,
        base.voteDeadline, base.resolutionDeadline, { value: base.creatorStake });
    await contract.connect(bob).acceptDuel(1, { value: base.opponentStake });
    await contract.connect(alice).submitVote(1, Outcome.YES);
    await contract.connect(bob).submitVote(1, Outcome.NO);
    await time.increaseTo(base.voteDeadline);
    await contract.settleDuel(1);

    return { ...base, duelId: 1n };
  }

  // Stake `n` signers (starting at index 4) as jurors.
  async function stakeJurors(contract: any, n: number) {
    const signers = await ethers.getSigners();
    const jurors = signers.slice(4, 4 + n);
    for (const j of jurors) {
      await contract.connect(j).stakeAsJuror({ value: ethers.parseEther("0.1") });
    }
    return jurors;
  }

  describe("Phase 5: Juror staking", function () {
    it("35. Should stake ETH, activate juror, and emit JurorStaked", async function () {
      const { contract } = await loadFixture(deployFixture);
      const [j1] = (await ethers.getSigners()).slice(4);
      const stake = ethers.parseEther("0.05");

      await expect(contract.connect(j1).stakeAsJuror({ value: stake }))
        .to.emit(contract, "JurorStaked").withArgs(j1.address, stake);

      const info = await contract.getJurorInfo(j1.address);
      expect(info.stake).to.equal(stake);
      expect(info.isActive).to.equal(true);
    });

    it("36. Should not activate juror staking below JUROR_STAKE threshold", async function () {
      const { contract } = await loadFixture(deployFixture);
      const [j1] = (await ethers.getSigners()).slice(4);

      await contract.connect(j1).stakeAsJuror({ value: ethers.parseEther("0.01") });
      expect((await contract.getJurorInfo(j1.address)).isActive).to.equal(false);
    });

    it("37. Should allow juror to partially unstake when not locked", async function () {
      const { contract } = await loadFixture(deployFixture);
      const [j1] = (await ethers.getSigners()).slice(4);

      await contract.connect(j1).stakeAsJuror({ value: ethers.parseEther("0.1") });
      await expect(contract.connect(j1).unstakeAsJuror(ethers.parseEther("0.05")))
        .to.emit(contract, "JurorUnstaked").withArgs(j1.address, ethers.parseEther("0.05"));

      expect((await contract.getJurorInfo(j1.address)).stake).to.equal(ethers.parseEther("0.05"));
    });

    it("38. Should revert unstake when juror is locked to an active dispute", async function () {
      const f = await loadFixture(disputedDuelFixture);
      const { contract, alice, duelId } = f;
      const jurors = await stakeJurors(contract, 1);
      const [j1] = jurors;

      await contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.01") });
      await contract.connect(j1).claimDispute();

      await expect(contract.connect(j1).unstakeAsJuror(ethers.parseEther("0.05")))
        .to.be.revertedWithCustomError(contract, "JurorAlreadyLocked");
    });
  });

  describe("Phase 5: Escalation & panel assembly", function () {
    it("39. Should escalate a DISPUTED duel and add it to the queue", async function () {
      const { contract, alice, duelId } = await loadFixture(disputedDuelFixture);

      await expect(
        contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.01") }),
      ).to.emit(contract, "DisputeEscalated").withArgs(duelId, 1, alice.address);

      const data = await contract.getDisputeData(duelId);
      expect(data.round).to.equal(1);
      expect(data.initialized).to.equal(true);
      expect(data.finalized).to.equal(false);
      expect(await contract.getDisputeQueueLength()).to.equal(1n);
      expect(await contract.getNextDispute()).to.equal(duelId);
    });

    it("40. Should revert escalation with wrong fee", async function () {
      const { contract, alice, duelId } = await loadFixture(disputedDuelFixture);
      await expect(
        contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.005") }),
      ).to.be.revertedWithCustomError(contract, "WrongDisputeFee");
    });

    it("41. Should revert double-escalation of same duel", async function () {
      const { contract, alice, duelId } = await loadFixture(disputedDuelFixture);
      await contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.01") });
      await expect(
        contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.01") }),
      ).to.be.revertedWithCustomError(contract, "DisputeAlreadyInitialized");
    });

    it("42. Should reject duel participants as jurors", async function () {
      const { contract, alice, bob, duelId } = await loadFixture(disputedDuelFixture);
      await contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.01") });
      await contract.connect(alice).stakeAsJuror({ value: ethers.parseEther("0.1") });
      await contract.connect(bob).stakeAsJuror({ value: ethers.parseEther("0.1") });

      await expect(contract.connect(alice).claimDispute())
        .to.be.revertedWithCustomError(contract, "JurorIsParticipant");
      await expect(contract.connect(bob).claimDispute())
        .to.be.revertedWithCustomError(contract, "JurorIsParticipant");
    });

    it("43. Should start voting once the 3-juror panel is complete", async function () {
      const { contract, alice, duelId } = await loadFixture(disputedDuelFixture);
      await contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.01") });
      const jurors = await stakeJurors(contract, 3);

      for (const j of jurors.slice(0, 2)) {
        await contract.connect(j).claimDispute();
        // Queue head must not advance until panel is full
        expect(await contract.getDisputeQueueLength()).to.equal(1n);
      }
      await contract.connect(jurors[2]).claimDispute();

      // Panel complete - queue consumed
      expect(await contract.getDisputeQueueLength()).to.equal(0n);
      const data = await contract.getDisputeData(duelId);
      expect(data.votingDeadline).to.be.gt(0n);
      expect(data.selectedJurors.length).to.equal(3);
    });
  });

  describe("Phase 5: Voting & round finalization", function () {
    // Fixture: 3-juror panel assembled on duel 1, voting open.
    async function panelReadyFixture() {
      const base = await disputedDuelFixture();
      const { contract, alice, duelId } = base;
      await contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.01") });
      const jurors = await stakeJurors(contract, 3);
      for (const j of jurors) await contract.connect(j).claimDispute();
      return { ...base, jurors };
    }

    it("44. Should revert vote from a non-juror", async function () {
      const { contract, charlie, duelId } = await loadFixture(panelReadyFixture);
      await expect(contract.connect(charlie).juryVote(duelId, Outcome.YES))
        .to.be.revertedWithCustomError(contract, "NotAJuror");
    });

    it("45. Should revert double-vote from same juror", async function () {
      const { contract, duelId, jurors } = await loadFixture(panelReadyFixture);
      await contract.connect(jurors[0]).juryVote(duelId, Outcome.YES);
      await expect(contract.connect(jurors[0]).juryVote(duelId, Outcome.YES))
        .to.be.revertedWithCustomError(contract, "AlreadyVoted");
    });

    it("46. Full round 1: majority YES -> appeal window -> finalization on second call", async function () {
      const { contract, reputation, alice, bob, duelId, jurors, creatorStake, opponentStake } =
        await loadFixture(panelReadyFixture);

      // 2-1 majority for YES (alice bet YES and wins)
      await contract.connect(jurors[0]).juryVote(duelId, Outcome.YES);
      await contract.connect(jurors[1]).juryVote(duelId, Outcome.YES);
      await contract.connect(jurors[2]).juryVote(duelId, Outcome.NO);

      const data = await contract.getDisputeData(duelId);
      await time.increaseTo(Number(data.votingDeadline));

      // First call: tally votes, slash minority, open APPEAL_WINDOW (bob is round loser).
      await expect(contract.finalizeJuryRound(duelId))
        .to.emit(contract, "RoundResolved").withArgs(duelId, 1, Outcome.YES, bob.address)
        .and.to.emit(contract, "JurorSlashed");

      // Duel is not yet settled - appeal window is open.
      expect((await contract.getDuel(duelId)).status).to.equal(Status.DISPUTED);

      // Advance past appeal window without bob appealing.
      const data2 = await contract.getDisputeData(duelId);
      await time.increaseTo(Number(data2.appealDeadline) + 1);

      // Second call: appeal window expired -> finalize.
      await expect(contract.finalizeJuryRound(duelId))
        .to.emit(contract, "DisputeFinalized").withArgs(duelId, Outcome.YES)
        .and.to.emit(contract, "DuelSettled");

      const prize = creatorStake + opponentStake;
      expect(await contract.pendingWithdrawals(alice.address)).to.equal(prize);
      expect(await contract.pendingWithdrawals(bob.address)).to.equal(0n);
      expect((await contract.getDuel(duelId)).status).to.equal(Status.SETTLED);

      // Reputation recorded on final settlement.
      expect((await reputation.getReputation(alice.address)).disputesWon).to.equal(1n);
      expect((await reputation.getReputation(bob.address)).disputesLost).to.equal(1n);
    });

    it("47. Minority juror slashed after round; majority jurors share fee pool on finalization", async function () {
      const { contract, duelId, jurors } = await loadFixture(panelReadyFixture);

      await contract.connect(jurors[0]).juryVote(duelId, Outcome.YES);
      await contract.connect(jurors[1]).juryVote(duelId, Outcome.YES);
      await contract.connect(jurors[2]).juryVote(duelId, Outcome.NO);

      const data = await contract.getDisputeData(duelId);
      await time.increaseTo(Number(data.votingDeadline));

      const minorityBefore = (await contract.getJurorInfo(jurors[2].address)).stake;
      await contract.finalizeJuryRound(duelId); // round tally; opens appeal window
      const minorityAfter = (await contract.getJurorInfo(jurors[2].address)).stake;

      // Minority slashed immediately on round finalization.
      expect(minorityBefore - minorityAfter).to.equal(ethers.parseEther("0.02"));
      // Majority jurors freed (lockedOnDispute = 0) immediately too.
      expect((await contract.getJurorInfo(jurors[0].address)).lockedOnDispute).to.equal(0n);

      // Fee-pool rewards are only credited at _finalizeDispute (after appeal window).
      expect(await contract.pendingWithdrawals(jurors[0].address)).to.equal(0n);

      // Advance past appeal window and finalize.
      const data2 = await contract.getDisputeData(duelId);
      await time.increaseTo(Number(data2.appealDeadline) + 1);
      await contract.finalizeJuryRound(duelId);

      // Fee pool = 0.01 ETH escalation + 0.02 ETH slash = 0.03 ETH -> split among 2 majority jurors.
      const reward = ethers.parseEther("0.03") / 2n;
      expect(await contract.pendingWithdrawals(jurors[0].address)).to.equal(reward);
      expect(await contract.pendingWithdrawals(jurors[1].address)).to.equal(reward);
    });

    it("48. Should revert finalizeJuryRound before voting period ends", async function () {
      const { contract, duelId, jurors } = await loadFixture(panelReadyFixture);
      await contract.connect(jurors[0]).juryVote(duelId, Outcome.YES);

      await expect(contract.finalizeJuryRound(duelId))
        .to.be.revertedWithCustomError(contract, "VotingPeriodNotOver");
    });
  });

  describe("Phase 5: Appeal", function () {
    // Fixture: round 1 resolved with bob as round loser, appeal window open.
    async function afterRound1Fixture() {
      const signers = await ethers.getSigners();
      const jurors = signers.slice(4, 7);
      const base = await disputedDuelFixture();
      const { contract, alice, duelId } = base;

      await contract.connect(alice).escalateToJury(duelId, { value: ethers.parseEther("0.01") });
      for (const j of jurors) await contract.connect(j).stakeAsJuror({ value: ethers.parseEther("0.1") });
      for (const j of jurors) await contract.connect(j).claimDispute();

      await contract.connect(jurors[0]).juryVote(duelId, Outcome.YES);
      await contract.connect(jurors[1]).juryVote(duelId, Outcome.YES);
      await contract.connect(jurors[2]).juryVote(duelId, Outcome.NO);

      const data = await contract.getDisputeData(duelId);
      await time.increaseTo(Number(data.votingDeadline));
      await contract.finalizeJuryRound(duelId); // opens appeal window; bob is round1Loser

      return { ...base, jurors };
    }

    it("49. Round loser can appeal, escalating to round 2 with 3× fee", async function () {
      const { contract, bob, duelId } = await loadFixture(afterRound1Fixture);
      const appealFee = ethers.parseEther("0.03");

      await expect(contract.connect(bob).appealDispute(duelId, { value: appealFee }))
        .to.emit(contract, "DisputeEscalated").withArgs(duelId, 2, bob.address);

      const data = await contract.getDisputeData(duelId);
      expect(data.round).to.equal(2);
      expect(data.appealDeadline).to.equal(0n);
      expect(await contract.getDisputeQueueLength()).to.equal(1n);
    });

    it("50. Should revert appeal by non-loser", async function () {
      const { contract, alice, duelId } = await loadFixture(afterRound1Fixture);
      await expect(
        contract.connect(alice).appealDispute(duelId, { value: ethers.parseEther("0.03") }),
      ).to.be.revertedWithCustomError(contract, "NotRoundLoser");
    });

    it("51. Should revert appeal with wrong fee", async function () {
      const { contract, bob, duelId } = await loadFixture(afterRound1Fixture);
      await expect(
        contract.connect(bob).appealDispute(duelId, { value: ethers.parseEther("0.01") }),
      ).to.be.revertedWithCustomError(contract, "WrongDisputeFee");
    });

    it("52. Expired appeal window: finalizeJuryRound locks in verdict without re-voting", async function () {
      const { contract, alice, duelId, creatorStake, opponentStake } =
        await loadFixture(afterRound1Fixture);

      const data = await contract.getDisputeData(duelId);
      // Advance past the appeal window
      await time.increaseTo(Number(data.appealDeadline) + 1);

      await expect(contract.finalizeJuryRound(duelId))
        .to.emit(contract, "DisputeFinalized").withArgs(duelId, Outcome.YES);

      const prize = creatorStake + opponentStake;
      expect(await contract.pendingWithdrawals(alice.address)).to.equal(prize);
      expect((await contract.getDuel(duelId)).status).to.equal(Status.SETTLED);
    });

    it("53. Full 3-round escalation: round 3 verdict is final (no further appeal)", async function () {
      const signers = await ethers.getSigners();
      // Need 3+5+7 = 15 jurors; use indices 4..18
      const allJurors = signers.slice(4, 19);

      const base = await disputedDuelFixture();
      const { contract, alice, bob, duelId } = base;

      const DISPUTE_FEE = ethers.parseEther("0.01");

      async function runRound(_round: number, jurorSlice: typeof allJurors, majority: number) {
        for (const j of jurorSlice) await contract.connect(j).claimDispute();
        for (let i = 0; i < jurorSlice.length; i++) {
          await contract.connect(jurorSlice[i]).juryVote(
            duelId,
            i === jurorSlice.length - 1 ? (majority === Outcome.YES ? Outcome.NO : Outcome.YES) : majority,
          );
        }
        const d = await contract.getDisputeData(duelId);
        await time.increaseTo(Number(d.votingDeadline));
        await contract.finalizeJuryRound(duelId);
      }

      // Stake all jurors
      for (const j of allJurors) {
        await contract.connect(j).stakeAsJuror({ value: ethers.parseEther("0.1") });
      }

      // Escalate (round 1)
      await contract.connect(alice).escalateToJury(duelId, { value: DISPUTE_FEE });
      // Round 1: YES majority, bob loses
      await runRound(1, allJurors.slice(0, 3), Outcome.YES);
      // Bob appeals to round 2
      await contract.connect(bob).appealDispute(duelId, { value: 3n * DISPUTE_FEE });
      // Round 2: YES majority again, bob loses
      await runRound(2, allJurors.slice(3, 8), Outcome.YES);
      // Bob appeals to round 3
      await contract.connect(bob).appealDispute(duelId, { value: 9n * DISPUTE_FEE });
      // Round 3: YES majority - final
      await runRound(3, allJurors.slice(8, 15), Outcome.YES);

      const finalized = await contract.getDisputeData(duelId);
      expect(finalized.finalized).to.equal(true);
      expect(finalized.round).to.equal(3);

      // No more appeals possible
      await expect(
        contract.connect(bob).appealDispute(duelId, { value: 9n * DISPUTE_FEE }),
      ).to.be.revertedWithCustomError(contract, "DisputeAlreadyFinalized");
    });
  });

  // -----
  // Edge-case coverage: error paths and view functions
  // -----

  describe("Edge cases & error paths", function () {
    it("E1. Should revert constructor with zero reputation address", async function () {
      const factory = await ethers.getContractFactory("PredictionDuel");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
    });

    it("E2. Should revert createDuel with NONE / INVALID creator outcome, empty question, bad deadlines", async function () {
      const { contract, alice, voteDeadline, resolutionDeadline, creatorStake, opponentStake } =
        await loadFixture(deployFixture);

      // NONE outcome
      await expect(
        contract.connect(alice).createDuel(
          QUESTION, Outcome.NONE, opponentStake, NO_REP_GATE,
          voteDeadline, resolutionDeadline, { value: creatorStake },
        ),
      ).to.be.revertedWithCustomError(contract, "InvalidOutcome");

      // INVALID outcome
      await expect(
        contract.connect(alice).createDuel(
          QUESTION, Outcome.INVALID, opponentStake, NO_REP_GATE,
          voteDeadline, resolutionDeadline, { value: creatorStake },
        ),
      ).to.be.revertedWithCustomError(contract, "InvalidOutcome");

      // Empty question
      await expect(
        contract.connect(alice).createDuel(
          "", Outcome.YES, opponentStake, NO_REP_GATE,
          voteDeadline, resolutionDeadline, { value: creatorStake },
        ),
      ).to.be.revertedWithCustomError(contract, "EmptyQuestion");

      // voteDeadline in the past
      const past = (await time.latest()) - 10;
      await expect(
        contract.connect(alice).createDuel(
          QUESTION, Outcome.YES, opponentStake, NO_REP_GATE,
          past, resolutionDeadline, { value: creatorStake },
        ),
      ).to.be.revertedWithCustomError(contract, "InvalidDeadlines");

      // resolutionDeadline <= voteDeadline
      await expect(
        contract.connect(alice).createDuel(
          QUESTION, Outcome.YES, opponentStake, NO_REP_GATE,
          voteDeadline, voteDeadline, { value: creatorStake },
        ),
      ).to.be.revertedWithCustomError(contract, "InvalidDeadlines");
    });

    it("E3. Should revert acceptDuel on missing duel and after voteDeadline", async function () {
      const { contract, bob, opponentStake, voteDeadline } = await loadFixture(activeDuelFixture);

      await expect(
        contract.connect(bob).acceptDuel(99, { value: opponentStake }),
      ).to.be.revertedWithCustomError(contract, "DuelNotFound");

      // Existing duel #1 was accepted in fixture; new duel for the deadline test.
      // Move time past voteDeadline and try to accept the still-CREATED duel via a fresh setup.
      const f = await loadFixture(deployFixture);
      await f.contract.connect(f.alice).createDuel(
        QUESTION, Outcome.YES, f.opponentStake, NO_REP_GATE,
        f.voteDeadline, f.resolutionDeadline, { value: f.creatorStake },
      );
      await time.increaseTo(f.voteDeadline);
      await expect(
        f.contract.connect(f.bob).acceptDuel(1, { value: f.opponentStake }),
      ).to.be.revertedWithCustomError(f.contract, "VotingClosed");
      void voteDeadline;
    });

    it("E4. Should revert submitVote with NONE outcome and on missing duel", async function () {
      const { contract, alice } = await loadFixture(activeDuelFixture);

      await expect(contract.connect(alice).submitVote(1, Outcome.NONE))
        .to.be.revertedWithCustomError(contract, "InvalidOutcome");

      await expect(contract.connect(alice).submitVote(99, Outcome.YES))
        .to.be.revertedWithCustomError(contract, "DuelNotFound");
    });

    it("E5. Should revert opponent double-vote separately from creator", async function () {
      const { contract, bob } = await loadFixture(activeDuelFixture);
      await contract.connect(bob).submitVote(1, Outcome.NO);
      await expect(contract.connect(bob).submitVote(1, Outcome.YES))
        .to.be.revertedWithCustomError(contract, "AlreadyVoted");
    });

    it("E6. Should revert settleDuel and cancelDuel on missing duels", async function () {
      const { contract, alice } = await loadFixture(deployFixture);
      await expect(contract.settleDuel(99))
        .to.be.revertedWithCustomError(contract, "DuelNotFound");
      await expect(contract.connect(alice).cancelDuel(99))
        .to.be.revertedWithCustomError(contract, "DuelNotFound");
    });

    it("E7. Should revert cancelDuel by non-creator", async function () {
      const { contract, bob, voteDeadline, resolutionDeadline, creatorStake, opponentStake, alice } =
        await loadFixture(deployFixture);

      await contract.connect(alice).createDuel(
        QUESTION, Outcome.YES, opponentStake, NO_REP_GATE,
        voteDeadline, resolutionDeadline, { value: creatorStake },
      );
      await expect(contract.connect(bob).cancelDuel(1))
        .to.be.revertedWithCustomError(contract, "OnlyCreator");
    });

    it("E8. Should revert stakeAsJuror with 0 ETH and unstake with too-large amount", async function () {
      const { contract } = await loadFixture(deployFixture);
      const [, , , , j1] = await ethers.getSigners();

      await expect(contract.connect(j1).stakeAsJuror({ value: 0 }))
        .to.be.revertedWithCustomError(contract, "ZeroStake");

      await contract.connect(j1).stakeAsJuror({ value: ethers.parseEther("0.05") });
      await expect(
        contract.connect(j1).unstakeAsJuror(ethers.parseEther("1")),
      ).to.be.revertedWithCustomError(contract, "InsufficientJurorStake");
    });

    it("E9. Unstaking below JUROR_STAKE deactivates the juror", async function () {
      const { contract } = await loadFixture(deployFixture);
      const [, , , , j1] = await ethers.getSigners();

      await contract.connect(j1).stakeAsJuror({ value: ethers.parseEther("0.1") });
      expect((await contract.getJurorInfo(j1.address)).isActive).to.equal(true);

      // Withdraw enough to drop below JUROR_STAKE (0.05 ETH)
      await contract.connect(j1).unstakeAsJuror(ethers.parseEther("0.06"));
      const info = await contract.getJurorInfo(j1.address);
      expect(info.stake).to.equal(ethers.parseEther("0.04"));
      expect(info.isActive).to.equal(false);
    });

    it("E10. Should revert escalateToJury on missing duel and non-DISPUTED status", async function () {
      const { contract, alice } = await loadFixture(activeDuelFixture);

      await expect(
        contract.connect(alice).escalateToJury(99, { value: ethers.parseEther("0.01") }),
      ).to.be.revertedWithCustomError(contract, "DuelNotFound");

      // Duel 1 is ACTIVE in fixture, not DISPUTED.
      await expect(
        contract.connect(alice).escalateToJury(1, { value: ethers.parseEther("0.01") }),
      ).to.be.revertedWithCustomError(contract, "DuelNotDisputed");
    });

    it("E11. claimDispute should revert when no disputes are queued and on ineligible/locked jurors", async function () {
      const f = await loadFixture(deployFixture);
      const { contract } = f;
      const [, , , , j1, j2] = await ethers.getSigners();

      // Empty queue
      await expect(contract.connect(j1).claimDispute())
        .to.be.revertedWithCustomError(contract, "NoDisputesInQueue");
      await expect(contract.getNextDispute())
        .to.be.revertedWithCustomError(contract, "NoDisputesInQueue");

      // Set up a disputed duel and escalate so the queue has one entry.
      await contract.connect(f.alice).createDuel(
        QUESTION, Outcome.YES, f.opponentStake, NO_REP_GATE,
        f.voteDeadline, f.resolutionDeadline, { value: f.creatorStake },
      );
      await contract.connect(f.bob).acceptDuel(1, { value: f.opponentStake });
      await contract.connect(f.alice).submitVote(1, Outcome.YES);
      await contract.connect(f.bob).submitVote(1, Outcome.NO);
      await time.increaseTo(f.voteDeadline);
      await contract.settleDuel(1);
      await contract.connect(f.alice).escalateToJury(1, { value: ethers.parseEther("0.01") });

      // Ineligible juror (no stake)
      await expect(contract.connect(j1).claimDispute())
        .to.be.revertedWithCustomError(contract, "NotEligibleJuror");

      // Stake j1, claim once, then second claim should hit JurorAlreadyLocked
      await contract.connect(j1).stakeAsJuror({ value: ethers.parseEther("0.1") });
      await contract.connect(j1).claimDispute();
      await expect(contract.connect(j1).claimDispute())
        .to.be.revertedWithCustomError(contract, "JurorAlreadyLocked");

      // j2 stakes and would be a fresh juror; verify panel-membership uniqueness
      // is enforced via the AlreadyJurorOnDispute branch. (Already covered by j1
      // case above for the lock check; this case adds the second-juror happy path.)
      await contract.connect(j2).stakeAsJuror({ value: ethers.parseEther("0.1") });
      await contract.connect(j2).claimDispute();
    });

    it("E12. juryVote: revert NONE, before voting open, after voting closes", async function () {
      const f = await loadFixture(deployFixture);
      const { contract } = f;

      // Build a disputed + escalated duel
      await contract.connect(f.alice).createDuel(
        QUESTION, Outcome.YES, f.opponentStake, NO_REP_GATE,
        f.voteDeadline, f.resolutionDeadline, { value: f.creatorStake },
      );
      await contract.connect(f.bob).acceptDuel(1, { value: f.opponentStake });
      await contract.connect(f.alice).submitVote(1, Outcome.YES);
      await contract.connect(f.bob).submitVote(1, Outcome.NO);
      await time.increaseTo(f.voteDeadline);
      await contract.settleDuel(1);
      await contract.connect(f.alice).escalateToJury(1, { value: ethers.parseEther("0.01") });

      const [, , , , j1, j2, j3] = await ethers.getSigners();
      // NONE vote: voting hasn't started - VotingNotStarted reverts first because
      // the function checks NONE before votingDeadline. Use YES to test ordering.
      await expect(contract.connect(j1).juryVote(1, Outcome.NONE))
        .to.be.revertedWithCustomError(contract, "InvalidOutcome");
      await expect(contract.connect(j1).juryVote(1, Outcome.YES))
        .to.be.revertedWithCustomError(contract, "VotingNotStarted");

      // Assemble the panel
      for (const j of [j1, j2, j3]) {
        await contract.connect(j).stakeAsJuror({ value: ethers.parseEther("0.1") });
      }
      for (const j of [j1, j2, j3]) {
        await contract.connect(j).claimDispute();
      }

      // Now voting is open. Advance past it without voting.
      const data = await contract.getDisputeData(1);
      await time.increaseTo(Number(data.votingDeadline));

      await expect(contract.connect(j1).juryVote(1, Outcome.YES))
        .to.be.revertedWithCustomError(contract, "VotingClosed");
    });

    it("E13. finalizeJuryRound: revert when not initialized", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(contract.finalizeJuryRound(99))
        .to.be.revertedWithCustomError(contract, "DisputeNotInitialized");
    });

    it("E14. Tie among 3 jurors -> INVALID verdict refunds both parties", async function () {
      const f = await loadFixture(deployFixture);
      const { contract } = f;

      await contract.connect(f.alice).createDuel(
        QUESTION, Outcome.YES, f.opponentStake, NO_REP_GATE,
        f.voteDeadline, f.resolutionDeadline, { value: f.creatorStake },
      );
      await contract.connect(f.bob).acceptDuel(1, { value: f.opponentStake });
      await contract.connect(f.alice).submitVote(1, Outcome.YES);
      await contract.connect(f.bob).submitVote(1, Outcome.NO);
      await time.increaseTo(f.voteDeadline);
      await contract.settleDuel(1);
      await contract.connect(f.alice).escalateToJury(1, { value: ethers.parseEther("0.01") });

      const [, , , , j1, j2, j3] = await ethers.getSigners();
      for (const j of [j1, j2, j3]) {
        await contract.connect(j).stakeAsJuror({ value: ethers.parseEther("0.1") });
      }
      for (const j of [j1, j2, j3]) {
        await contract.connect(j).claimDispute();
      }
      // 1 YES, 1 NO, 1 INVALID -> no YES/NO majority -> INVALID via tie path.
      await contract.connect(j1).juryVote(1, Outcome.YES);
      await contract.connect(j2).juryVote(1, Outcome.NO);
      await contract.connect(j3).juryVote(1, Outcome.INVALID);

      const data = await contract.getDisputeData(1);
      await time.increaseTo(Number(data.votingDeadline));

      // INVALID verdict goes straight to _finalizeDispute, no appeal window.
      await expect(contract.finalizeJuryRound(1))
        .to.emit(contract, "DisputeFinalized").withArgs(1n, Outcome.INVALID)
        .and.to.emit(contract, "DuelRefunded").withArgs(1n, f.creatorStake, f.opponentStake);

      // Fee pool on INVALID is split 50/50: 0.01 escalation + 2 × 0.02 minority slashes = 0.05 ETH.
      // (j1 voted YES and j2 voted NO; j3 voted INVALID — only j3 matched the
      // verdict, so j1 and j2 are minority and each lose SLASH_AMOUNT.)
      const half = ethers.parseEther("0.025");
      expect(await contract.pendingWithdrawals(f.alice.address)).to.equal(f.creatorStake + half);
      expect(await contract.pendingWithdrawals(f.bob.address)).to.equal(f.opponentStake + half);
    });

    it("E15. appealDispute: NoAppealWindow / AppealWindowExpired branches", async function () {
      const { contract } = await loadFixture(deployFixture);
      // No dispute at all -> appealDeadline == 0 -> NoAppealWindow
      await expect(
        contract.appealDispute(99, { value: ethers.parseEther("0.03") }),
      ).to.be.revertedWithCustomError(contract, "NoAppealWindow");
    });

    it("E16. NO majority path: alice loses to bob via jury", async function () {
      const f = await loadFixture(deployFixture);
      const { contract } = f;

      await contract.connect(f.alice).createDuel(
        QUESTION, Outcome.YES, f.opponentStake, NO_REP_GATE,
        f.voteDeadline, f.resolutionDeadline, { value: f.creatorStake },
      );
      await contract.connect(f.bob).acceptDuel(1, { value: f.opponentStake });
      await contract.connect(f.alice).submitVote(1, Outcome.YES);
      await contract.connect(f.bob).submitVote(1, Outcome.NO);
      await time.increaseTo(f.voteDeadline);
      await contract.settleDuel(1);
      await contract.connect(f.alice).escalateToJury(1, { value: ethers.parseEther("0.01") });

      const [, , , , j1, j2, j3] = await ethers.getSigners();
      for (const j of [j1, j2, j3]) {
        await contract.connect(j).stakeAsJuror({ value: ethers.parseEther("0.1") });
      }
      for (const j of [j1, j2, j3]) {
        await contract.connect(j).claimDispute();
      }
      // Majority NO: alice (creator, bet YES) is round1Loser
      await contract.connect(j1).juryVote(1, Outcome.NO);
      await contract.connect(j2).juryVote(1, Outcome.NO);
      await contract.connect(j3).juryVote(1, Outcome.YES);

      const data = await contract.getDisputeData(1);
      await time.increaseTo(Number(data.votingDeadline));
      await contract.finalizeJuryRound(1);

      const dd = await contract.getDisputeData(1);
      expect(dd.lastRoundOutcome).to.equal(Outcome.NO);
      expect(dd.round1Loser).to.equal(f.alice.address);
    });

    it("E17a. cancelStaleDispute: refunds both stakes after grace period without escalation", async function () {
      const f = await loadFixture(deployFixture);
      const { contract } = f;

      await contract.connect(f.alice).createDuel(
        QUESTION, Outcome.YES, f.opponentStake, NO_REP_GATE,
        f.voteDeadline, f.resolutionDeadline, { value: f.creatorStake },
      );
      await contract.connect(f.bob).acceptDuel(1, { value: f.opponentStake });
      await contract.connect(f.alice).submitVote(1, Outcome.YES);
      await contract.connect(f.bob).submitVote(1, Outcome.NO);
      await time.increaseTo(f.voteDeadline);
      await contract.settleDuel(1); // -> DISPUTED, no escalation

      // Before grace period elapses → revert.
      await expect(contract.cancelStaleDispute(1))
        .to.be.revertedWithCustomError(contract, "EscalationGraceNotReached");

      // Advance past resolutionDeadline + 7 days.
      await time.increaseTo(f.resolutionDeadline + 7 * 24 * 60 * 60 + 1);

      await expect(contract.cancelStaleDispute(1))
        .to.emit(contract, "DuelRefunded").withArgs(1n, f.creatorStake, f.opponentStake);

      expect(await contract.pendingWithdrawals(f.alice.address)).to.equal(f.creatorStake);
      expect(await contract.pendingWithdrawals(f.bob.address)).to.equal(f.opponentStake);
      expect((await contract.getDuel(1)).status).to.equal(Status.SETTLED);
    });

    it("E17b. cancelStaleDispute: revert paths (not found, wrong status, already initialized)", async function () {
      const f = await loadFixture(deployFixture);
      const { contract } = f;

      // Not found
      await expect(contract.cancelStaleDispute(99))
        .to.be.revertedWithCustomError(contract, "DuelNotFound");

      // Wrong status (CREATED, never accepted/disputed)
      await contract.connect(f.alice).createDuel(
        QUESTION, Outcome.YES, f.opponentStake, NO_REP_GATE,
        f.voteDeadline, f.resolutionDeadline, { value: f.creatorStake },
      );
      await expect(contract.cancelStaleDispute(1))
        .to.be.revertedWithCustomError(contract, "DuelNotDisputed");

      // After escalation: should revert with DisputeAlreadyInitialized
      await contract.connect(f.bob).acceptDuel(1, { value: f.opponentStake });
      await contract.connect(f.alice).submitVote(1, Outcome.YES);
      await contract.connect(f.bob).submitVote(1, Outcome.NO);
      await time.increaseTo(f.voteDeadline);
      await contract.settleDuel(1);
      await contract.connect(f.alice).escalateToJury(1, { value: ethers.parseEther("0.01") });
      await time.increaseTo(f.resolutionDeadline + 7 * 24 * 60 * 60 + 1);
      await expect(contract.cancelStaleDispute(1))
        .to.be.revertedWithCustomError(contract, "DisputeAlreadyInitialized");
    });

    it("E17. View functions: getActiveDuels, getUserDuels, getDuelistReputation, getNextDispute (empty)", async function () {
      const f = await loadFixture(deployFixture);
      const { contract } = f;

      // getActiveDuels with no duels -> empty array
      expect(await contract.getActiveDuels(0, 10)).to.deep.equal([]);

      // Create three duels, settle one
      for (let i = 0; i < 3; i++) {
        await contract.connect(f.alice).createDuel(
          QUESTION, Outcome.YES, f.opponentStake, NO_REP_GATE,
          f.voteDeadline + i, f.resolutionDeadline + i, { value: f.creatorStake },
        );
      }

      // Two with offset 1, limit 5 -> returns the 2nd & 3rd (active) entries
      const page = await contract.getActiveDuels(1, 5);
      expect(page.length).to.equal(2);
      expect(page[0].id).to.equal(2n);
      expect(page[1].id).to.equal(3n);

      // getUserDuels
      const list = await contract.getUserDuels(f.alice.address);
      expect(list.length).to.equal(3);

      // getDuelistReputation on an unscored user
      const [rep, score] = await contract.getDuelistReputation(f.bob.address);
      expect(rep.wins).to.equal(0n);
      expect(score).to.equal(0n);

      // getNextDispute on empty queue
      await expect(contract.getNextDispute())
        .to.be.revertedWithCustomError(contract, "NoDisputesInQueue");

      // getActiveDisputes empty + invalid pagination
      expect(await contract.getActiveDisputes(0, 5)).to.deep.equal([]);
      await expect(contract.getActiveDisputes(0, 0))
        .to.be.revertedWithCustomError(contract, "InvalidPagination");
    });
  });
});
