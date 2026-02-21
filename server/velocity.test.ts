import { describe, it, expect } from "vitest";
import type { SprintRecord } from "./analytics.js";
import { generateVelocitySvg } from "./velocity.js";

function makeRecord(overrides: Partial<SprintRecord> = {}): SprintRecord {
  return {
    sprintId: "team-1000000000000",
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    completedAt: new Date().toISOString(),
    cycle: 1,
    totalTasks: 5,
    completedTasks: 4,
    blockedTasks: 0,
    avgReviewRoundsPerTask: 1,
    totalMessages: 10,
    agents: ["eng-1"],
    ...overrides,
  };
}

describe("generateVelocitySvg", () => {
  describe("empty state", () => {
    it("returns valid SVG for empty records", () => {
      const svg = generateVelocitySvg([]);
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
    });

    it("shows 'No sprint data yet' placeholder for empty records", () => {
      const svg = generateVelocitySvg([]);
      expect(svg).toContain("No sprint data yet");
    });

    it("uses default dimensions for empty state", () => {
      const svg = generateVelocitySvg([]);
      expect(svg).toContain('width="600"');
      expect(svg).toContain('height="200"');
    });
  });

  describe("SVG structure", () => {
    it("has correct xmlns attribute", () => {
      const svg = generateVelocitySvg([makeRecord()]);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it("contains a background rect", () => {
      const svg = generateVelocitySvg([makeRecord()]);
      expect(svg).toContain("<rect");
    });

    it("contains bar rects for each sprint", () => {
      const records = [makeRecord(), makeRecord({ cycle: 2 }), makeRecord({ cycle: 3 })];
      const svg = generateVelocitySvg(records);
      // Should have multiple rect elements (background + bars)
      const rectMatches = svg.match(/<rect/g) ?? [];
      expect(rectMatches.length).toBeGreaterThan(3);
    });

    it("uses default width=600 and height=200", () => {
      const svg = generateVelocitySvg([makeRecord()]);
      expect(svg).toContain('width="600"');
      expect(svg).toContain('height="200"');
    });

    it("respects custom dimensions", () => {
      const svg = generateVelocitySvg([makeRecord()], { width: 800, height: 300 });
      expect(svg).toContain('width="800"');
      expect(svg).toContain('height="300"');
    });

    it("includes y-axis percentage labels", () => {
      const svg = generateVelocitySvg([makeRecord()]);
      expect(svg).toContain("0%");
      expect(svg).toContain("50%");
      expect(svg).toContain("100%");
    });

    it("includes sprint index labels on x-axis", () => {
      const records = [makeRecord(), makeRecord({ cycle: 2 }), makeRecord({ cycle: 3 })];
      const svg = generateVelocitySvg(records);
      expect(svg).toContain(">1<");
      expect(svg).toContain(">2<");
      expect(svg).toContain(">3<");
    });

    it("shows sprint count and latest rate in summary labels", () => {
      const records = [
        makeRecord({ completedTasks: 4, totalTasks: 5 }),
        makeRecord({ completedTasks: 3, totalTasks: 3, cycle: 2 }),
      ];
      const svg = generateVelocitySvg(records);
      expect(svg).toContain("Sprints: 2");
      expect(svg).toContain("Latest: 100%");
    });
  });

  describe("bar colors", () => {
    it("uses green for >= 80% completion rate", () => {
      const svg = generateVelocitySvg([makeRecord({ completedTasks: 5, totalTasks: 5 })]);
      expect(svg).toContain("#22c55e");
    });

    it("uses yellow for >= 50% and < 80% completion rate", () => {
      const svg = generateVelocitySvg([makeRecord({ completedTasks: 3, totalTasks: 5 })]);
      expect(svg).toContain("#eab308");
    });

    it("uses red for < 50% completion rate", () => {
      const svg = generateVelocitySvg([makeRecord({ completedTasks: 1, totalTasks: 5 })]);
      expect(svg).toContain("#ef4444");
    });

    it("uses green at exactly 80%", () => {
      const svg = generateVelocitySvg([makeRecord({ completedTasks: 4, totalTasks: 5 })]);
      expect(svg).toContain("#22c55e");
    });

    it("uses yellow at exactly 50%", () => {
      const svg = generateVelocitySvg([makeRecord({ completedTasks: 1, totalTasks: 2 })]);
      expect(svg).toContain("#eab308");
    });
  });

  describe("review rounds dashed line", () => {
    it("renders a dashed polyline when there are multiple records", () => {
      const records = [makeRecord(), makeRecord({ cycle: 2, avgReviewRoundsPerTask: 2 })];
      const svg = generateVelocitySvg(records);
      expect(svg).toContain("<polyline");
      expect(svg).toContain("stroke-dasharray");
    });

    it("omits the dashed line for a single record", () => {
      const svg = generateVelocitySvg([makeRecord()]);
      expect(svg).not.toContain("<polyline");
    });
  });

  describe("0 tasks edge case", () => {
    it("renders a 1px tall bar for 0% completion", () => {
      const svg = generateVelocitySvg([makeRecord({ completedTasks: 0, totalTasks: 5 })]);
      // Bar height max(1, 0) = 1
      expect(svg).toContain('height="1"');
    });

    it("computes 0% when totalTasks is 0", () => {
      const svg = generateVelocitySvg([makeRecord({ completedTasks: 0, totalTasks: 0 })]);
      // 0% → red
      expect(svg).toContain("#ef4444");
    });
  });
});
