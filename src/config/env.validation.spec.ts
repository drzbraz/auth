import { validate } from './env.validation';

describe('validate (env)', () => {
  const base = {
    MONGODB_URI: 'mongodb://localhost/test',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
  };

  it('should throw when MONGODB_URI is missing', () => {
    expect(() => validate({ JWT_ACCESS_SECRET: 'x' })).toThrow(/MONGODB_URI/);
  });

  it('should throw when JWT_ACCESS_SECRET is missing', () => {
    expect(() => validate({ MONGODB_URI: 'mongodb://x' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('should throw when JWT_ACCESS_SECRET is empty', () => {
    expect(() => validate({ ...base, JWT_ACCESS_SECRET: '' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('should apply defaults for token lifetimes', () => {
    const env = validate(base);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
  });

  it('should parse REFRESH_TOKEN_TTL_DAYS as a number', () => {
    expect(validate({ ...base, REFRESH_TOKEN_TTL_DAYS: '30' })).toMatchObject({
      REFRESH_TOKEN_TTL_DAYS: 30,
    });
  });

  it('should throw when REFRESH_TOKEN_TTL_DAYS is not a positive integer', () => {
    expect(() => validate({ ...base, REFRESH_TOKEN_TTL_DAYS: 'abc' })).toThrow(
      /REFRESH_TOKEN_TTL_DAYS/,
    );
    expect(() => validate({ ...base, REFRESH_TOKEN_TTL_DAYS: '0' })).toThrow(
      /REFRESH_TOKEN_TTL_DAYS/,
    );
  });

  it('should pass through optional initial user settings', () => {
    const env = validate({
      ...base,
      INITIAL_USER_USERNAME: 'admin',
      INITIAL_USER_PASSWORD: 'pw',
    });
    expect(env.INITIAL_USER_USERNAME).toBe('admin');
    expect(env.INITIAL_USER_PASSWORD).toBe('pw');
  });

  it('should throw when INITIAL_USER_USERNAME is shorter than 3 chars', () => {
    expect(() =>
      validate({
        ...base,
        INITIAL_USER_USERNAME: 'ab',
        INITIAL_USER_PASSWORD: 'pw',
      }),
    ).toThrow(/INITIAL_USER_USERNAME/);
  });
});
