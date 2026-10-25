import { describe, expect, it } from "vitest";
import {
  angleDelta,
  atan2Deg,
  cosDeg,
  distSqrd,
  lengthDeg,
  pointInCircle,
  randInt,
  rotateToward,
  sinDeg,
  wrapDeg,
} from "../src/core/math";

describe("degree math (Flash convention: 0° = +x, clockwise, −180…+180)", () => {
  it("atan2Deg", () => {
    expect(atan2Deg(0, 1)).toBeCloseTo(0);
    expect(atan2Deg(1, 0)).toBeCloseTo(90);
    expect(atan2Deg(0, -1)).toBeCloseTo(180);
    expect(atan2Deg(-1, 0)).toBeCloseTo(-90);
  });

  it("cosDeg / sinDeg", () => {
    expect(cosDeg(0)).toBeCloseTo(1);
    expect(cosDeg(90)).toBeCloseTo(0);
    expect(sinDeg(0)).toBeCloseTo(0);
    expect(sinDeg(90)).toBeCloseTo(1);
    // Flash y-down: 90° points DOWN (+y) — sinDeg positive.
    expect(sinDeg(90)).toBeGreaterThan(0);
  });

  it("wrapDeg keeps −180…+180", () => {
    expect(wrapDeg(0)).toBe(0);
    expect(wrapDeg(370)).toBe(10);
    expect(wrapDeg(-10)).toBe(-10);
    expect(wrapDeg(360)).toBe(0);
    expect(Math.abs(wrapDeg(-360))).toBe(0); // 0 modulo (sign of zero is irrelevant)
    expect(wrapDeg(540)).toBe(180);
    expect(wrapDeg(-540)).toBe(-180);
    for (let i = -5; i <= 5; i++) {
      const v = wrapDeg(i * 111);
      expect(v).toBeGreaterThanOrEqual(-180);
      expect(v).toBeLessThanOrEqual(180);
    }
  });

  it("angleDelta takes the shortest signed path", () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(angleDelta(0, 0)).toBe(0);
    expect(angleDelta(0, 180)).toBe(180);
    expect(angleDelta(0, -179)).toBe(-179); // shorter than +181
  });

  it("rotateToward never overshoots", () => {
    expect(rotateToward(0, 90, 30)).toBe(30);
    expect(rotateToward(0, 90, 100)).toBe(90); // clamped to the delta
    expect(rotateToward(10, -20, 5)).toBe(-5);
    expect(rotateToward(45, 45, 5)).toBe(0);
    expect(rotateToward(170, -170, 15)).toBe(15); // shortest path crosses 180
  });
});

describe("random helpers", () => {
  it("randInt stays within [min, max] inclusive", () => {
    for (let i = 0; i < 500; i++) {
      const v = randInt(-3, 7);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("randInt can produce both endpoints", () => {
    let seenMin = false;
    let seenMax = false;
    for (let i = 0; i < 2000 && !(seenMin && seenMax); i++) {
      const v = randInt(0, 3);
      if (v === 0) seenMin = true;
      if (v === 3) seenMax = true;
    }
    expect(seenMin).toBe(true);
    expect(seenMax).toBe(true);
  });
});

describe("vector helpers", () => {
  it("distSqrd", () => {
    expect(distSqrd(0, 0, 3, 4)).toBe(25);
    expect(distSqrd(-3, -4, 0, 0)).toBe(25);
    expect(distSqrd(5, 5, 5, 5)).toBe(0);
  });

  it("lengthDeg maps length+angle to components", () => {
    const v = lengthDeg(10, 0);
    expect(v.x).toBeCloseTo(10);
    expect(v.y).toBeCloseTo(0);
    const w = lengthDeg(10, 90);
    expect(w.x).toBeCloseTo(0);
    expect(w.y).toBeCloseTo(10);
  });

  it("pointInCircle", () => {
    expect(pointInCircle(0, 0, 0, 0, 5)).toBe(true);
    expect(pointInCircle(3, 4, 0, 0, 5)).toBe(true); // exactly on the rim
    expect(pointInCircle(3, 4, 0, 0, 4.9)).toBe(false);
    expect(pointInCircle(-1, -1, 0, 0, 2)).toBe(true);
  });
});
