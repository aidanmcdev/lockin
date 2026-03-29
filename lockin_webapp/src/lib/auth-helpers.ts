import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "focusup-dev-secret";

export function getUserId(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(header.split(" ")[1], JWT_SECRET) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}
