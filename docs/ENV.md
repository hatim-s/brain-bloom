# Environment variables

| Variable | Consumer | Required | Where to obtain it |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | The AI generation and AI editing server actions in `actions/ai-gen.ts` and `actions/ai-edit.ts`. | Required when using AI generation or editing. | Create an API key in the Groq console. |
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase browser client, server client, and session proxy. | Required to run the application with Supabase. | Copy the project URL from the Supabase project settings. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The Supabase browser client, server client, and session proxy. | Required to run the application with Supabase. | Copy the anonymous public key from the Supabase project API settings. |

All three variables are slated for removal in a later overhaul phase. Until that phase lands, place local values in `.env.local` and configure the same values in the deployment environment.
