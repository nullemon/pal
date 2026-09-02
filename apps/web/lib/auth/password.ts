import { hash, parseOptions, verify } from '@node-rs/argon2'

/** docs/07: Argon2id at the OWASP baseline — m=19456, t=2, p=1. */
export const ARGON2_PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2_PARAMS)

export const verifyPassword = async (hashed: string, password: string): Promise<boolean> => {
  try {
    return await verify(hashed, password)
  } catch {
    return false
  }
}

/** True when the stored hash was made with different parameters (rehash on login). */
export const needsRehash = (hashed: string): boolean => {
  try {
    const opts = parseOptions(hashed)
    return (
      opts.memoryCost !== ARGON2_PARAMS.memoryCost ||
      opts.timeCost !== ARGON2_PARAMS.timeCost ||
      opts.parallelism !== ARGON2_PARAMS.parallelism
    )
  } catch {
    return true
  }
}

let dummy: Promise<string> | undefined
/**
 * A hash to verify against when the account does not exist, so unknown emails take as
 * long as wrong passwords (docs/07: identical responses for unknown addresses).
 */
export const dummyHash = (): Promise<string> => {
  dummy ??= hashPassword('correct horse battery staple')
  return dummy
}
