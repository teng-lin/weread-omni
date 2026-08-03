import { describe, expect, it } from "vitest";
import { deviceVersionHeaders, einkDevice } from "../../src/device-ua.js";

describe("e-ink device identity", () => {
  it("is exact and stable", () => {
    expect(einkDevice()).toEqual({
      userAgent: "WeRead/2.1.2 WRBrand/Onyx wr_eink Dalvik/2.1.0 (Linux; U; Android 11; BOOX Build/onyx)",
      baseapi: "30",
      appver: "2.1.2.10245900",
      osver: "11",
      channelId: "900",
      deviceName: "BOOX",
      wrbrand: "Onyx",
    });
    expect(deviceVersionHeaders(einkDevice())).toEqual({
      baseapi: "30",
      appver: "2.1.2.10245900",
      basever: "2.1.2.10245900",
      osver: "11",
      channelId: "900",
      "User-Agent": einkDevice().userAgent,
    });
  });
});
