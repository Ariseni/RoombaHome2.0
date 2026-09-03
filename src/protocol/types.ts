/**
 * Shared types for the iRobot "Prime"/V4 cloud protocol.
 *
 * Field names mirror the wire format documented by roombapy-prime and
 * roomba-v4 (both reverse-engineered from the Roomba Home app).
 */

export type JsonObject = Record<string, unknown>;

/** GET disc-prod.iot.irobotapi.com/v1/discover/endpoints?country_code=XX */
export interface DiscoveryDeployment {
  awsRegion?: string;
  httpBase: string;
  httpBaseAuth: string;
  mqtt?: string;
  mqttApp?: string;
  mqttAts?: string;
  irbtTopics?: string;
  iotTopics?: string;
  svcDeplId?: string;
  [key: string]: unknown;
}

export interface DiscoveryResponse {
  current_deployment: string;
  gigya: { api_key: string; datacenter_domain: string };
  deployments: Record<string, DiscoveryDeployment>;
  [key: string]: unknown;
}

export interface GigyaIdentity {
  uid: string;
  signature: string;
  timestamp: string;
}

/** One entry of the /v2/login `connection_tokens` list. */
export interface ConnectionToken {
  clientId: string;
  iotToken: string;
  iotSignature: string;
  iotAuthorizerName: string;
  /** Unix seconds when the token stops working (≈5 min after issue). */
  expires: number | null;
  /** BLIDs this token is authorised for. */
  devices: string[];
}

export interface CloudCredentials {
  accessKeyId: string;
  secretKey: string;
  sessionToken: string;
  /** ISO 8601 */
  expiration: string | null;
  cognitoId: string;
  /** e.g. "us-east-1", parsed from CognitoId or discovery awsRegion */
  region: string;
}

export interface RobotLoginEntry {
  blid: string;
  name: string;
  sku: string;
  softwareVer: string;
  /** Local-channel password; unused for cloud but kept for completeness. */
  password?: string;
  svcDeplId?: string;
  cap: Record<string, number>;
  digiCap: Record<string, number>;
  raw: JsonObject;
}

export interface LoginResult {
  mqttEndpoint: string;
  httpBase: string;
  httpBaseAuth: string;
  irbtTopicPrefix: string;
  iotTopicPrefix: string;
  credentials: CloudCredentials;
  connectionTokens: ConnectionToken[];
  robots: Record<string, RobotLoginEntry>;
  raw: JsonObject;
  deployment: DiscoveryDeployment;
  /** Deployment id this login was made against, e.g. "v011". */
  deploymentId: string;
  availableDeployments: string[];
  /** When this login happened (ms since epoch). */
  issuedAt: number;
}

export interface Credentials {
  username: string;
  password: string;
  countryCode: string;
}

/** Message delivered by the MQTT client for one topic. */
export interface MqttMessage {
  topic: string;
  /** Parsed JSON if the payload was JSON, else null. */
  json: unknown | null;
  raw: Uint8Array;
}
