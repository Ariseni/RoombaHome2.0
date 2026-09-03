export class AuthError extends Error {
  readonly raw: unknown;
  constructor(message: string, raw?: unknown) {
    super(message);
    this.name = 'AuthError';
    this.raw = raw;
  }
}

/** Wrong username/password. Never retry automatically. */
export class AuthCredentialsError extends AuthError {
  constructor(message: string, raw?: unknown) {
    super(message, raw);
    this.name = 'AuthCredentialsError';
  }
}

/** iRobot refused because too many app sessions are open ("mqtt slot"). */
export class AuthRateLimitedError extends AuthError {
  constructor(message: string, raw?: unknown) {
    super(message, raw);
    this.name = 'AuthRateLimitedError';
  }
}

export class RestError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'RestError';
    this.status = status;
    this.body = body;
  }
}

export class MqttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MqttError';
  }
}

export class ShadowError extends MqttError {
  constructor(message: string) {
    super(message);
    this.name = 'ShadowError';
  }
}
