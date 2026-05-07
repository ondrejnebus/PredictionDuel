import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const ONE_YEAR = 365 * 24 * 60 * 60;

/// Tests target the DuelReputation contract in isolation. We deploy it with a
/// signer (`duelMock`) as the immutable `duelContract`, so that signer can call
/// every onlyDuelContract method directly. This lets us drive reputation state
/// transitions without going through PredictionDuel.
async function deployFixture() {
  const [deployer, duelMock, alice, bob, charlie, mallory] = await ethers.getSigners();
  const reputation = await ethers.deployContract("DuelReputation", [duelMock.address]);
  await reputation.waitForDeployment();
  return { reputation, deployer, duelMock, alice, bob, charlie, mallory };
}

describe("DuelReputation", function () {
  // -----
  // Constructor
  // -----

  describe("Constructor", function () {
    it("R1. Should revert when deploying with zero duelContract", async function () {
      const factory = await ethers.getContractFactory("DuelReputation");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
    });

    it("R2. Should expose the immutable duelContract address", async function () {
      const { reputation, duelMock } = await loadFixture(deployFixture);
      expect(await reputation.duelContract()).to.equal(duelMock.address);
    });

    it("R3. Should expose the canonical ERC-721 metadata", async function () {
      const { reputation } = await loadFixture(deployFixture);
      expect(await reputation.name()).to.equal("PredictionDuel Reputation");
      expect(await reputation.symbol()).to.equal("PDREP");
    });
  });

  // -----
  // Lazy minting & token id
  // -----

  describe("Lazy minting", function () {
    it("R4. Should derive tokenId deterministically from address", async function () {
      const { reputation, alice } = await loadFixture(deployFixture);
      const expected = BigInt(alice.address);
      expect(await reputation.tokenIdOf(alice.address)).to.equal(expected);
    });

    it("R5. Should mint exactly once per address (idempotent mintIfNeeded)", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);

      await expect(reputation.connect(duelMock).mintIfNeeded(alice.address))
        .to.emit(reputation, "ReputationMinted");
      expect(await reputation.balanceOf(alice.address)).to.equal(1n);

      // Second call must NOT emit and balance stays 1.
      const tx = await reputation.connect(duelMock).mintIfNeeded(alice.address);
      const receipt = await tx.wait();
      const minted = receipt!.logs.filter((l: any) => l.fragment?.name === "ReputationMinted");
      expect(minted.length).to.equal(0);
      expect(await reputation.balanceOf(alice.address)).to.equal(1n);
    });

    it("R6. Should revert mintIfNeeded for zero address", async function () {
      const { reputation, duelMock } = await loadFixture(deployFixture);
      await expect(
        reputation.connect(duelMock).mintIfNeeded(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(reputation, "ZeroAddress");
    });
  });

  // -----
  // Soulbound enforcement
  // -----

  describe("Soulbound enforcement", function () {
    it("R7. Should revert transferFrom between two non-zero addresses", async function () {
      const { reputation, duelMock, alice, bob } = await loadFixture(deployFixture);
      await reputation.connect(duelMock).mintIfNeeded(alice.address);
      const tokenId = await reputation.tokenIdOf(alice.address);

      await expect(
        reputation.connect(alice).transferFrom(alice.address, bob.address, tokenId),
      ).to.be.revertedWithCustomError(reputation, "SoulboundTransferDisallowed");
    });

    it("R8. Should revert safeTransferFrom between two non-zero addresses", async function () {
      const { reputation, duelMock, alice, bob } = await loadFixture(deployFixture);
      await reputation.connect(duelMock).mintIfNeeded(alice.address);
      const tokenId = await reputation.tokenIdOf(alice.address);

      await expect(
        reputation
          .connect(alice)
          ["safeTransferFrom(address,address,uint256)"](alice.address, bob.address, tokenId),
      ).to.be.revertedWithCustomError(reputation, "SoulboundTransferDisallowed");
    });

    it("R9. Should allow approve to be called (no-op, ERC-721 surface stays compliant)", async function () {
      const { reputation, duelMock, alice, bob } = await loadFixture(deployFixture);
      await reputation.connect(duelMock).mintIfNeeded(alice.address);
      const tokenId = await reputation.tokenIdOf(alice.address);
      // Approve does not transfer - must succeed even on soulbound tokens.
      await reputation.connect(alice).approve(bob.address, tokenId);
      expect(await reputation.getApproved(tokenId)).to.equal(bob.address);
    });
  });

  // -----
  // Access control
  // -----

  describe("Access control (onlyDuelContract)", function () {
    it("R10. Should reject mintIfNeeded from non-duel caller", async function () {
      const { reputation, mallory, alice } = await loadFixture(deployFixture);
      await expect(
        reputation.connect(mallory).mintIfNeeded(alice.address),
      ).to.be.revertedWithCustomError(reputation, "NotDuelContract");
    });

    it("R11. Should reject all record* calls from non-duel caller", async function () {
      const { reputation, mallory, alice } = await loadFixture(deployFixture);
      const stake = ethers.parseEther("0.1");

      await expect(reputation.connect(mallory).recordWin(alice.address, stake))
        .to.be.revertedWithCustomError(reputation, "NotDuelContract");
      await expect(reputation.connect(mallory).recordLoss(alice.address, stake))
        .to.be.revertedWithCustomError(reputation, "NotDuelContract");
      await expect(reputation.connect(mallory).recordNoShow(alice.address))
        .to.be.revertedWithCustomError(reputation, "NotDuelContract");
      await expect(reputation.connect(mallory).recordDisputeWin(alice.address))
        .to.be.revertedWithCustomError(reputation, "NotDuelContract");
      await expect(reputation.connect(mallory).recordDisputeLoss(alice.address))
        .to.be.revertedWithCustomError(reputation, "NotDuelContract");
    });
  });

  // -----
  // Win / loss scoring
  // -----

  describe("Scoring: wins & losses", function () {
    it("R12. Should award log2-weighted points across stake boundaries", async function () {
      const { reputation } = await loadFixture(deployFixture);
      // Sub-baseline -> flat 2
      expect(await reputation.winPointsForStake(0n)).to.equal(2n);
      // At baseline (0.001 ETH): 2 + log2(1) = 2
      expect(await reputation.winPointsForStake(ethers.parseEther("0.001"))).to.equal(2n);
      // 0.01 ETH: 2 + log2(10) = 5
      expect(await reputation.winPointsForStake(ethers.parseEther("0.01"))).to.equal(5n);
      // 1 ETH: 2 + log2(1000) = 11
      expect(await reputation.winPointsForStake(ethers.parseEther("1"))).to.equal(11n);
    });

    it("R13. Should accumulate volume on both wins and losses", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      const stakeA = ethers.parseEther("0.5");
      const stakeB = ethers.parseEther("0.3");

      await reputation.connect(duelMock).recordWin(alice.address, stakeA);
      await reputation.connect(duelMock).recordLoss(alice.address, stakeB);

      const rep = await reputation.getReputation(alice.address);
      expect(rep.wins).to.equal(1n);
      expect(rep.losses).to.equal(1n);
      expect(rep.totalVolumeWei).to.equal(stakeA + stakeB);
      // Losses do not contribute to winPointsAccum
      expect(rep.winPointsAccum).to.equal(10n); // 2 + log2(500)
    });

    it("R14. Should emit WinRecorded / LossRecorded with correct args", async function () {
      const { reputation, duelMock, alice, bob } = await loadFixture(deployFixture);
      const stake = ethers.parseEther("0.8");
      await expect(reputation.connect(duelMock).recordWin(alice.address, stake))
        .to.emit(reputation, "WinRecorded")
        .withArgs(alice.address, stake, 11n);
      await expect(reputation.connect(duelMock).recordLoss(bob.address, stake))
        .to.emit(reputation, "LossRecorded")
        .withArgs(bob.address, stake);
    });
  });

  // -----
  // No-show penalty (including the score-scaled path)
  // -----

  describe("Scoring: no-show penalty", function () {
    it("R15. Should apply flat base penalty (10) to fresh / unscored user", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      await expect(reputation.connect(duelMock).recordNoShow(alice.address))
        .to.emit(reputation, "NoShowRecorded")
        .withArgs(alice.address, 10n);

      const rep = await reputation.getReputation(alice.address);
      expect(rep.noShowCount).to.equal(1n);
      expect(rep.noShowPenaltyAccum).to.equal(10n);
      expect(await reputation.reputationScore(alice.address)).to.equal(-10n);
    });

    it("R16. Should scale penalty by score/5 when score is high", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      // Build alice's score above 50 so score/5 > 10 (the base penalty).
      // Eight 1-ETH wins -> 8 × 11 = 88 win points, score = 88.
      const oneEth = ethers.parseEther("1");
      for (let i = 0; i < 8; i++) {
        await reputation.connect(duelMock).recordWin(alice.address, oneEth);
      }
      expect(await reputation.reputationScore(alice.address)).to.equal(88n);

      // recordNoShow uses currentScore BEFORE rebase; expected penalty = 88 / 5 = 17.
      await expect(reputation.connect(duelMock).recordNoShow(alice.address))
        .to.emit(reputation, "NoShowRecorded")
        .withArgs(alice.address, 17n);

      const rep = await reputation.getReputation(alice.address);
      expect(rep.noShowPenaltyAccum).to.equal(17n);
      expect(await reputation.reputationScore(alice.address)).to.equal(88n - 17n);
    });

    it("R17. Should keep no-show penalty sticky (no decay)", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      await reputation.connect(duelMock).recordNoShow(alice.address);
      expect(await reputation.reputationScore(alice.address)).to.equal(-10n);

      await time.increase(3 * ONE_YEAR);
      expect(await reputation.reputationScore(alice.address)).to.equal(-10n);
    });
  });

  // -----
  // Dispute scoring
  // -----

  describe("Scoring: disputes", function () {
    it("R18. Should award +1 for dispute wins and -10 for dispute losses", async function () {
      const { reputation, duelMock, alice, bob } = await loadFixture(deployFixture);

      await reputation.connect(duelMock).recordDisputeWin(alice.address);
      await reputation.connect(duelMock).recordDisputeLoss(bob.address);

      expect(await reputation.reputationScore(alice.address)).to.equal(1n);
      expect(await reputation.reputationScore(bob.address)).to.equal(-10n);

      const aliceRep = await reputation.getReputation(alice.address);
      expect(aliceRep.disputesWon).to.equal(1n);
      expect(aliceRep.disputesInitiated).to.equal(1n);

      const bobRep = await reputation.getReputation(bob.address);
      expect(bobRep.disputesLost).to.equal(1n);
      expect(bobRep.disputesInitiated).to.equal(1n);
    });
  });

  // -----
  // Decay
  // -----

  describe("Decay", function () {
    it("R19. Should halve win points after one period (read-side decay)", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      await reputation.connect(duelMock).recordWin(alice.address, ethers.parseEther("1"));
      expect(await reputation.reputationScore(alice.address)).to.equal(11n);

      await time.increase(ONE_YEAR + 1);
      // 11 >> 1 = 5
      expect(await reputation.reputationScore(alice.address)).to.equal(5n);

      // Storage not yet rebased.
      expect((await reputation.getReputation(alice.address)).winPointsAccum).to.equal(11n);
    });

    it("R20. Should rebase storage and emit ReputationDecayed on next write", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      await reputation.connect(duelMock).recordWin(alice.address, ethers.parseEther("1"));

      await time.increase(2 * ONE_YEAR + 1);
      // 11 >> 2 = 2 (decayed), then we add a new win for 0.001 ETH (2 points).
      await expect(
        reputation.connect(duelMock).recordWin(alice.address, ethers.parseEther("0.001")),
      )
        .to.emit(reputation, "ReputationDecayed")
        .withArgs(alice.address, 2n);

      const rep = await reputation.getReputation(alice.address);
      expect(rep.winPointsAccum).to.equal(2n + 2n); // 2 from decay + 2 from new tiny win
    });

    it("R21. Should cap halvings at MAX_HALVINGS (30) for very long inactivity", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      await reputation.connect(duelMock).recordWin(alice.address, ethers.parseEther("1"));

      // 31 years inactive -> would be 31 halvings, capped to 30. 11 >> 30 = 0.
      await time.increase(31 * ONE_YEAR);
      expect(await reputation.reputationScore(alice.address)).to.equal(0n);

      // Persisting the rebase emits with halvings == 30 (the cap), not 31.
      await expect(
        reputation.connect(duelMock).recordWin(alice.address, ethers.parseEther("0.0001")),
      )
        .to.emit(reputation, "ReputationDecayed")
        .withArgs(alice.address, 30n);
    });

    it("R22. Should skip rebase when winPointsAccum is zero (no-op fast path)", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      // Only losses recorded, so winPointsAccum stays 0.
      await reputation.connect(duelMock).recordLoss(alice.address, ethers.parseEther("0.1"));

      await time.increase(5 * ONE_YEAR);
      // Next write should NOT emit ReputationDecayed.
      const tx = await reputation
        .connect(duelMock)
        .recordLoss(alice.address, ethers.parseEther("0.1"));
      const receipt = await tx.wait();
      const decayLogs = receipt!.logs.filter((l: any) => l.fragment?.name === "ReputationDecayed");
      expect(decayLogs.length).to.equal(0);
    });
  });

  // -----
  // tokenURI
  // -----

  describe("tokenURI", function () {
    it("R23. Should revert tokenURI for non-existent token", async function () {
      const { reputation, alice } = await loadFixture(deployFixture);
      const tokenId = await reputation.tokenIdOf(alice.address);
      // OZ v5 reverts with ERC721NonexistentToken on owner-of checks.
      await expect(reputation.tokenURI(tokenId)).to.be.revertedWithCustomError(
        reputation,
        "ERC721NonexistentToken",
      );
    });

    it("R24. Should encode signed scores (negative) correctly in metadata", async function () {
      const { reputation, duelMock, alice } = await loadFixture(deployFixture);
      // Mint and accrue a -10 no-show score.
      await reputation.connect(duelMock).recordNoShow(alice.address);
      const tokenId = await reputation.tokenIdOf(alice.address);

      const uri = await reputation.tokenURI(tokenId);
      expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
      const json = JSON.parse(
        Buffer.from(uri.slice("data:application/json;base64,".length), "base64").toString("utf8"),
      );
      const byName: Record<string, number | string> = {};
      for (const a of json.attributes) byName[a.trait_type] = a.value;

      expect(byName["Score"]).to.equal(-10);
      expect(byName["No-shows"]).to.equal(1);
    });
  });
});