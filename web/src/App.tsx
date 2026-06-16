import { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AdminAuthGuard } from './components/AdminAuthGuard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { Chat } from './pages/Chat';
import { EnterprisePeople } from './pages/EnterprisePeople';
import { KnowledgeBase } from './pages/KnowledgeBase';
import { Stats } from './pages/Stats';
import { Sessions } from './pages/Sessions';
import { Memory } from './pages/Memory';
import { Config } from './pages/Config';
import { Login } from './pages/Login';
import { ModelConfig } from './pages/ModelConfig';
import { Orchestration } from './pages/Orchestration';
import { Harness } from './pages/Harness';
import { AgentBuilder } from './pages/AgentBuilder';

import { Employees } from './pages/Employees';
import { SkillsMarketplace } from './pages/SkillsMarketplace';
import { Onboarding } from './pages/Onboarding';
import { NotFound } from './pages/NotFound';
import { api } from './lib/api';
import { useChatStore } from './stores/chat';
import { getToken } from './lib/auth';

export function App() {
  const location = useLocation();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const dataLoaded = useRef(false);

  useEffect(() => {
    api.getSetupStatus()
      .then(({ configured }) => {
        setNeedsSetup(!configured);
        setSetupChecked(true);
      })
      .catch(() => setSetupChecked(true));
  }, []);

  useEffect(() => {
    if (dataLoaded.current) return;

    const token = getToken();
    if (!token && location.pathname === '/login') return;
    dataLoaded.current = true;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    async function load() {
      const [tenantRes, workdirRes] = await Promise.all([
        api.listTenants(),
        fetch('/api/workdirs', { headers }),
      ]);

      const workdirList = (await workdirRes.json()) as Array<{
        id: string;
        displayName: string;
        path: string;
        channels: string[];
        status?: string;
        tenant?: string;
      }>;

      if (tenantRes.tenants.length > 0) {
        useChatStore.getState().setTenants(tenantRes.tenants);
      }

      useChatStore.getState().setWorkdirs(
        workdirList.map((w) => ({
          id: w.id,
          displayName: w.displayName || w.id,
          path: w.path,
          channels: w.channels,
          status: w.status,
          tenant: w.tenant,
        })),
      );
    }
    void load();
  }, [location.pathname]);

  if (!setupChecked) return null;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AdminAuthGuard><ErrorBoundary><Layout needsSetup={needsSetup} /></ErrorBoundary></AdminAuthGuard>}>
        <Route index element={<Dashboard />} />
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:botName" element={<Chat />} />
        <Route path="people" element={<EnterprisePeople />} />
        <Route path="employees" element={<Employees />} />
        <Route path="employee-network" element={<Navigate to="/employees" replace />} />
        <Route path="people-binding" element={<Navigate to="/people" replace />} />
        <Route path="skills-marketplace" element={<SkillsMarketplace />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="bots" element={<Navigate to="/config" replace />} />
        <Route path="entry-routing" element={<Navigate to="/config" replace />} />
        <Route path="knowledge" element={<KnowledgeBase />} />
        <Route path="orchestration" element={<Orchestration />} />
        <Route path="harness" element={<Harness />} />
        <Route path="agent-builder" element={<AgentBuilder />} />
        <Route path="capabilities" element={<Navigate to="/skills-marketplace" replace />} />
        <Route path="stats" element={<Stats />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="scheduler" element={<Navigate to="/orchestration" replace />} />
        <Route path="memory" element={<Memory />} />

        <Route path="config" element={<Config />} />
        <Route path="model-config" element={<ModelConfig />} />
        <Route path="setup" element={<Navigate to="/model-config" replace />} />
        <Route path="agent-status" element={<Navigate to="/sessions" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
