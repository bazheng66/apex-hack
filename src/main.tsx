import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.tsx"
import { ErrorBoundary } from "./components/ErrorBoundary.tsx"
import { bootstrapSupabaseAuth } from "./lib/supabase.ts"
import "./index.css"

void bootstrapSupabaseAuth()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
