import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.tsx"
import { bootstrapSupabaseAuth } from "./lib/supabase.ts"
import "./index.css"

void bootstrapSupabaseAuth()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
