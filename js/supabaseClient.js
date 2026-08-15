import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=27";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
