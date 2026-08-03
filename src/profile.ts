import { createHash, randomBytes, randomInt } from "node:crypto";
import { deviceVersionHeaders, einkDevice } from "./device-ua.js";

export interface ClientProfile {
  readonly versionHeaders: Record<string, string>;
  readonly deviceName: string;
  readonly deviceType: number;
  authHeaders(token: { vid: string; accessToken: string }): Record<string, string>;
  refreshSignature(deviceId: string, timestamp: number, random: number, refreshToken: string): string;
  loginBodyExtras(): Record<string, unknown>;
  newDeviceId(): string;
  newInstallId(): string;
}

const digits = (length: number): string => Array.from({ length }, () => randomInt(10)).join("");
const LEAF3_DEVICE_ID_PREFIX = "eink334691225";
const leaf3DeviceId = (): string =>
  `${LEAF3_DEVICE_ID_PREFIX}${BigInt.asUintN(63, randomBytes(8).readBigUInt64BE()).toString().padStart(19, "0")}`;

export function einkProfile(): ClientProfile {
  const device = einkDevice();
  return {
    versionHeaders: deviceVersionHeaders(device),
    deviceName: device.deviceName,
    deviceType: 3,
    authHeaders: ({ vid, accessToken }) => ({ vid, accessToken }),
    refreshSignature: (deviceId, timestamp, random) =>
      createHash("sha256").update(`${timestamp}${deviceId}${random}`).digest("hex"),
    loginBodyExtras: () => ({ deviceType: 3 }),
    newDeviceId: leaf3DeviceId,
    newInstallId: () => `eink31${digits(26)}`,
  };
}

export function resolveProfile(options: { profile?: ClientProfile }): ClientProfile {
  return options.profile ?? einkProfile();
}
