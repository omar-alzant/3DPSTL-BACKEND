// src/supabase.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config(); // must be first!


const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Base options for client creation
const clientOptions = { auth: { persistSession: false } };

// For verifying user tokens from the frontend (Bearer)
export const supabaseAnon = createClient(url, anon, clientOptions);

// For privileged DB writes (server-side only)
export const supabaseAdmin = createClient(url, svc, clientOptions);

export const supabase = createClient(url, anon);

/**
 * Creates a Supabase client configured with a specific user's JWT token.
 * This client can then perform user-specific actions like updateUser.
 * @param {string} token - The user's JWT from the Authorization header.
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export const getAuthenticatedSupabaseClient = (token) => {
    // When the anon key is used but a JWT is provided in the headers, 
    // Supabase will use the JWT for authentication.
    // Use global option to set Authorization header for all requests
    const client = createClient(url, anon, {
        ...clientOptions,
        global: {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    });
    
    return client;
};