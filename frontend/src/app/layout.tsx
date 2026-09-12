import type { Metadata } from 'next';
import './globals.css';
import React from 'react';

export const metadata: Metadata = {
  title: 'TITAN — Operational Resilience & Incident Command',
  description: 'Enterprise-grade real-time operational resilience, incident war-room, and automated runbook platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0d14] text-slate-100 antialiased flex flex-col">
        {/* Navigation Header */}
        <header className="border-b border-slate-800 bg-[#0d131f]/90 backdrop-blur sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-black text-white text-lg tracking-wider shadow-lg shadow-blue-500/20">
              T
            </div>
            <div>
              <span className="font-bold tracking-tight text-white text-lg">TITAN</span>
              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-950 text-blue-400 border border-blue-800/60 uppercase tracking-wide">
                Resilience Engine
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 px-2.5 py-1 rounded-full bg-emerald-950/50 border border-emerald-800/40 text-emerald-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Cluster: US-East-1 (Healthy)</span>
            </div>

            <div className="flex items-center space-x-2 text-xs text-slate-400 border-l border-slate-800 pl-4">
              <span>Admin: Sarah Chen (Commander)</span>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 flex overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
