import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type ClientProfile, einkProfile, resolveProfile } from "../../src/profile.js";

describe("e-ink client profile", () => {
  it("is the default and owns one coherent identity", () => {
    const profile = resolveProfile({});
    expect(profile.versionHeaders).toMatchObject({
      appver: "2.1.2.10245900",
      basever: "2.1.2.10245900",
      baseapi: "30",
      osver: "11",
      channelId: "900",
      "User-Agent": expect.stringContaining("WRBrand/Onyx wr_eink"),
    });
    expect(profile.deviceName).toBe("BOOX");
    expect(profile.deviceType).toBe(3);
    expect(profile.loginBodyExtras()).toEqual({ deviceType: 3 });
    for (let sample = 0; sample < 256; sample += 1) {
      const deviceId = profile.newDeviceId();
      expect(deviceId).toMatch(/^eink334691225\d{19}$/);
      expect(BigInt(deviceId.slice("eink334691225".length))).toBeLessThanOrEqual(9_223_372_036_854_775_807n);
    }
    expect(profile.newInstallId()).toMatch(/^eink31\d{26}$/);
  });

  it("uses vid/accessToken request auth", () => {
    expect(einkProfile().authHeaders({ vid: "123", accessToken: "token" })).toEqual({
      vid: "123",
      accessToken: "token",
    });
  });

  it("uses direct SHA-256 without binding the refresh token", () => {
    const profile = einkProfile();
    const expected = createHash("sha256").update("7device11").digest("hex");
    expect(profile.refreshSignature("device", 7, 11, "refresh-a")).toBe(expected);
    expect(profile.refreshSignature("device", 7, 11, "refresh-b")).toBe(expected);
  });

  it("accepts an explicit profile unchanged", () => {
    const profile: ClientProfile = {
      versionHeaders: { "User-Agent": "custom-client" },
      deviceName: "custom",
      deviceType: 9,
      authHeaders: ({ vid }) => ({ vid, customAuth: "yes" }),
      refreshSignature: () => "signature",
      loginBodyExtras: () => ({ deviceType: 9 }),
      newDeviceId: () => "custom-device",
      newInstallId: () => "custom-install",
    };
    expect(resolveProfile({ profile })).toBe(profile);
  });

  it("does not expose device override options", () => {
    // @ts-expect-error A public profile is the only identity override seam.
    resolveProfile({ device: { deviceName: "other" } });
  });
});
