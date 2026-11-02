import { backend } from "./fakeBackend";

/**
 * MOCK ONLY. Stands in for src/integrations/supabase/client.ts. Only the fake
 * backend's small surface exists, so anything else the real code tried here
 * would fail with an error rather than reach anywhere.
 */
export const supabase = backend.client;
