import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://robinfbzmiorirwjcpyx.supabase.co";
const supabaseKey = "sb_publishable_bDtEZz0gosFbKB6l5leaEQ_Rd8VAsf2";

export const supabase = createClient(supabaseUrl, supabaseKey);
