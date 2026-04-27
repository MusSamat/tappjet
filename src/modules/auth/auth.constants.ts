// OTP and phone-change limits from TZ §7.6
export const OTP_TTL_SEC = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_BRUTEFORCE_BLOCK_MIN = 15;
export const OTP_DAILY_CAP = 5;
export const OTP_MIN_GAP_SEC = 60;
export const PHONE_CHANGE_DAILY_CAP = 3;
