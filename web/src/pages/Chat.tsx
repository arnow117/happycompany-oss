import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { useChatStore } from '../stores/chat';
import type { RuntimeChatContext } from '../stores/chat';

export function Chat() {
  const selectedWorkdir = useChatStore((s) => s.selectedWorkdir);
  const setSelectedWorkdir = useChatStore((s) => s.setSelectedWorkdir);
  const setSelectedTenant = useChatStore((s) => s.setSelectedTenant);
  const tenants = useChatStore((s) => s.tenants);
  const allWorkdirs = useChatStore((s) => s.workdirs);
  const selectedTenant = useChatStore((s) => s.selectedTenant);
  const syncRouteSelection = useChatStore((s) => s.syncRouteSelection);
  const params = useParams();
  const [searchParams] = useSearchParams();
  const routeWorkdirId = params.botName;
  const effectiveWorkdirId = routeWorkdirId || selectedWorkdir || 'web';
  const routeWorkdir = routeWorkdirId ? allWorkdirs.find((w) => w.id === routeWorkdirId) : null;
  const initialRuntimeContext = useMemo<RuntimeChatContext>(() => ({
    tenant: searchParams.get('tenant') || undefined,
    entryId: searchParams.get('entry') || undefined,
    actorId: searchParams.get('actor') || undefined,
    targetEmployeeId: searchParams.get('employee') || undefined,
    sessionId: searchParams.get('session') || undefined,
    chatId: searchParams.get('chat') || undefined,
  }), [searchParams]);

  const filteredWorkdirs = useMemo(() => {
    if (!selectedTenant) return allWorkdirs;
    const tenantScoped = allWorkdirs.filter(
      (w) => w.tenant === selectedTenant || (!w.tenant && selectedTenant === '__none__'),
    );
    const currentWorkdir = allWorkdirs.find((w) => w.id === effectiveWorkdirId);
    if (currentWorkdir && !tenantScoped.some((w) => w.id === currentWorkdir.id)) {
      return [currentWorkdir, ...tenantScoped];
    }
    return tenantScoped;
  }, [allWorkdirs, effectiveWorkdirId, selectedTenant]);

  useLayoutEffect(() => {
    if (!routeWorkdirId) {
      return;
    }

    const inferredTenant =
      routeWorkdir?.tenant ||
      (tenants.some((tenant) => tenant.id === routeWorkdirId) ? routeWorkdirId : '');

    syncRouteSelection(routeWorkdirId, inferredTenant || undefined);
  }, [routeWorkdirId, routeWorkdir?.tenant, syncRouteSelection, tenants]);

  useEffect(() => {
    if (initialRuntimeContext.tenant && initialRuntimeContext.tenant !== selectedTenant) {
      setSelectedTenant(initialRuntimeContext.tenant);
    }
  }, [initialRuntimeContext.tenant, selectedTenant, setSelectedTenant]);

  return (
    <ChatView
      selectedWorkdir={effectiveWorkdirId}
      workdirs={filteredWorkdirs}
      initialRuntimeContext={initialRuntimeContext}
      onWorkdirChange={(id) => {
        const next = allWorkdirs.find((w) => w.id === id);
        if (next?.tenant && next.tenant !== selectedTenant) {
          syncRouteSelection(id, next.tenant);
          return;
        }
        setSelectedWorkdir(id);
        useChatStore.getState().resetConversationFor(id);
      }}
    />
  );
}
