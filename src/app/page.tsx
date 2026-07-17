export default function Home() {
  return (
    <main className="min-h-screen bg-gray-900 text-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-5xl font-bold mb-4">Native Share Cloud</h1>
        <p className="text-lg text-gray-300 mb-6">
          A Vercel-hosted control plane for local hotspot sharing, QuickShare sessions, and Claude-guided automation.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800 p-4 rounded border border-gray-700">
            <h2 className="text-xl font-semibold mb-2">Host Agent</h2>
            <p className="text-sm text-gray-400">Runs on the machine that owns hotspot control, local files, and device sessions.</p>
          </div>
          <div className="bg-gray-800 p-4 rounded border border-gray-700">
            <h2 className="text-xl font-semibold mb-2">Guest Portal</h2>
            <p className="text-sm text-gray-400">Phones and laptops join from the browser with QR pairing and uploads.</p>
          </div>
          <div className="bg-gray-800 p-4 rounded border border-gray-700">
            <h2 className="text-xl font-semibold mb-2">Claude Orchestration</h2>
            <p className="text-sm text-gray-400">AI triggers only approved app tools for safe automation.</p>
          </div>
          <div className="bg-gray-800 p-4 rounded border border-gray-700">
            <h2 className="text-xl font-semibold mb-2">Status</h2>
            <p className="text-sm text-gray-400">
              <a href="/api/status" className="text-blue-400 hover:underline">/api/status</a> - App health
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
