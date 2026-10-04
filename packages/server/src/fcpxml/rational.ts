export interface Rational {
  n: bigint;
  d: bigint;
}
function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}
export function rational(n: bigint, d: bigint): Rational {
  if (n < 0n || d <= 0n)
    throw new Error('Time must be a nonnegative rational value');
  const divisor = gcd(n, d);
  return { n: n / divisor, d: d / divisor };
}
export function frameSeconds(frames: number, frameRate: string): Rational {
  if (
    !Number.isSafeInteger(frames) ||
    frames < 0 ||
    !/^\d+(?:\/\d+)?$/.test(frameRate)
  )
    throw new Error('Invalid exact frame timing');
  const [numerator, denominator = '1'] = frameRate.split('/');
  return rational(BigInt(frames) * BigInt(denominator), BigInt(numerator!));
}
export function add(left: Rational, right: Rational): Rational {
  return rational(left.n * right.d + right.n * left.d, left.d * right.d);
}
export function compare(left: Rational, right: Rational): number {
  const value = left.n * right.d - right.n * left.d;
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}
export function toFcpxmlTime(time: Rational): string {
  const reduced = rational(time.n, time.d);
  if (reduced.n > 9223372036854775807n || reduced.d > 4294967295n)
    throw new Error(
      'Time exceeds FCPXML 64-bit numerator or 32-bit denominator',
    );
  return reduced.d === 1n ? `${reduced.n}s` : `${reduced.n}/${reduced.d}s`;
}
