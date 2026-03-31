import { SignJWT, jwtVerify, errors } from "jose";

export async function createAgentToken(
  payload: { agentId: string; owner: string; permissions?: string[] },
  secret: string,
  expiresIn?: string,
): Promise<string> {
  const encoder = new TextEncoder();
  let builder = new SignJWT({
    agentId: payload.agentId,
    owner: payload.owner,
    permissions: payload.permissions,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt();

  if (expiresIn) {
    builder = builder.setExpirationTime(expiresIn);
  }

  return builder.sign(encoder.encode(secret));
}

export async function verifyAgentToken(
  token: string,
  secret: string,
): Promise<{ agentId: string; owner: string; permissions?: string[] }> {
  const encoder = new TextEncoder();
  const { payload } = await jwtVerify(token, encoder.encode(secret));
  return {
    agentId: payload.agentId as string,
    owner: payload.owner as string,
    permissions: payload.permissions as string[] | undefined,
  };
}

export async function extractAgentId(req: Request, jwtSecret: string): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const decoded = await verifyAgentToken(token, jwtSecret);
      return decoded.agentId;
    } catch {
      // Invalid JWT, fall through
    }
  }

  const agentHeader = req.headers.get("X-Agent-Id");
  if (agentHeader) return agentHeader;

  return "anonymous";
}
