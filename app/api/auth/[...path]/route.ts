import { clinicianAuth } from "../../../lib/auth/server";

export const dynamic = "force-dynamic";
const handlers = clinicianAuth().handler();
export const { GET, POST, PUT, DELETE, PATCH } = handlers;
