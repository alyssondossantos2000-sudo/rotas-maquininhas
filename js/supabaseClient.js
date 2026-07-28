import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=7";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
