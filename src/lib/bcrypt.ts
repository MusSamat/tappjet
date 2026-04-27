import bcrypt from 'bcryptjs';

// TZ §27 "bcrypt rounds=12" for admin passwords. We use the same cost for
// OTP hashes — overkill for 5-minute tokens but avoids any mistake of
// accidentally using a weak cost for long-lived secrets.
const ROUNDS = 12;

// Lower cost in test env — 12 rounds adds ~200ms per hash which compounds
// across dozens of tests. 4 is Node bcryptjs minimum that still exercises the algorithm.
const TEST_ROUNDS = 4;

function rounds(): number {
  return process.env.NODE_ENV === 'test' ? TEST_ROUNDS : ROUNDS;
}

export async function hash(plain: string): Promise<string> {
  return bcrypt.hash(plain, rounds());
}

export async function verify(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}
