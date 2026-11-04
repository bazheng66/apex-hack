import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom"
import Account from "./components/Account.tsx"
import Mock from "./components/Mock.tsx"
import Progress from "./components/Progress.tsx"
import Setup from "./components/Setup.tsx"
import Shell from "./components/Shell.tsx"
import SwitchSubject from "./components/SwitchSubject.tsx"
import Talk from "./components/Talk.tsx"
import Today from "./components/Today.tsx"
import Welcome from "./components/Welcome.tsx"
import { RecordProvider, useRecord } from "./lib/useRecord.tsx"

function Home() {
  const { state } = useRecord()
  if (state) return <Navigate to="/today" replace />
  return <Welcome />
}

function Workspace() {
  const { state } = useRecord()
  if (!state) return <Navigate to="/" replace />
  return <Shell />
}

function NotFound() {
  return (
    <main className="sheet mx-auto min-h-svh max-w-xl px-5 py-24 sm:px-6">
      <p className="text-[11px] tracking-[0.28em] text-muted">404</p>
      <h1 className="mt-5 font-serif text-3xl font-semibold leading-snug text-ink">这一页不存在</h1>
      <p className="mt-4 text-sm leading-7 text-muted">地址可能写错了。回到首页重新开始，记录不会丢。</p>
      <Link
        to="/"
        className="mt-8 inline-flex h-12 items-center rounded-[2px] bg-seal px-6 text-sm text-paper hover:bg-[#742418]"
      >
        回到首页
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <RecordProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          {/* Reachable without a record: a new device signs in here before it has one. */}
          <Route path="/account" element={<Account />} />
          <Route path="/start" element={<Setup />} />
          <Route element={<Workspace />}>
            <Route path="/today" element={<Today />} />
            <Route path="/talk" element={<Talk />} />
            <Route path="/mock" element={<Mock />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/switch" element={<SwitchSubject />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </RecordProvider>
  )
}
