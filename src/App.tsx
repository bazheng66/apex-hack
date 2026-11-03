import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import Mock from "./components/Mock.tsx"
import Progress from "./components/Progress.tsx"
import Setup from "./components/Setup.tsx"
import Shell from "./components/Shell.tsx"
import Talk from "./components/Talk.tsx"
import Today from "./components/Today.tsx"
import { RecordProvider, useRecord } from "./lib/useRecord.tsx"

function Home() {
  const { state } = useRecord()
  if (state) return <Navigate to="/today" replace />
  return <Setup />
}

function Workspace() {
  const { state } = useRecord()
  if (!state) return <Navigate to="/" replace />
  return <Shell />
}

export default function App() {
  return (
    <RecordProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route element={<Workspace />}>
            <Route path="/today" element={<Today />} />
            <Route path="/talk" element={<Talk />} />
            <Route path="/mock" element={<Mock />} />
            <Route path="/progress" element={<Progress />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </RecordProvider>
  )
}
