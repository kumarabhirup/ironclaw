"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { ChatMessage } from "./chat-message";

/** Imperative handle for parent-driven session control (main page). */
export type ChatPanelHandle = {
	loadSession: (sessionId: string) => Promise<void>;
	newSession: () => Promise<void>;
};

export type FileContext = {
	path: string;
	filename: string;
};

type FileScopedSession = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
};

type ChatPanelProps = {
	/** When set, scopes sessions to this file and prepends content as context. */
	fileContext?: FileContext;
	/** Compact mode for workspace sidebar (smaller UI, built-in session tabs). */
	compact?: boolean;
	/** Called when file content may have changed after agent edits. */
	onFileChanged?: (newContent: string) => void;
	/** Called when active session changes (for external sidebar highlighting). */
	onActiveSessionChange?: (sessionId: string | null) => void;
	/** Called when session list needs refresh (for external sidebar). */
	onSessionsChange?: () => void;
};

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
	function ChatPanel(
		{
			fileContext,
			compact,
			onFileChanged,
			onActiveSessionChange,
			onSessionsChange,
		},
		ref,
	) {
		const [input, setInput] = useState("");
		const [currentSessionId, setCurrentSessionId] = useState<
			string | null
		>(null);
		const [loadingSession, setLoadingSession] = useState(false);
		const [startingNewSession, setStartingNewSession] = useState(false);
		const messagesEndRef = useRef<HTMLDivElement>(null);

		// Track persisted messages to avoid double-saves
		const savedMessageIdsRef = useRef<Set<string>>(new Set());
		// Set when /new or + triggers a new session
		const newSessionPendingRef = useRef(false);
		// Whether the next message should include file context
		const isFirstFileMessageRef = useRef(true);

		// File-scoped session list (compact mode only)
		const [fileSessions, setFileSessions] = useState<
			FileScopedSession[]
		>([]);

		const filePath = fileContext?.path ?? null;

		// ── Ref-based session ID for transport ──
		const sessionIdRef = useRef<string | null>(null);
		useEffect(() => {
			sessionIdRef.current = currentSessionId;
		}, [currentSessionId]);

		// ── Transport (per-instance) ──
		const transport = useMemo(
			() =>
				new DefaultChatTransport({
					api: "/api/chat",
					body: () => {
						const sid = sessionIdRef.current;
						return sid ? { sessionId: sid } : {};
					},
				}),
			[],
		);

		const { messages, sendMessage, status, stop, error, setMessages } =
			useChat({ transport });

		const isStreaming =
			status === "streaming" || status === "submitted";

		// Auto-scroll to bottom on new messages
		useEffect(() => {
			messagesEndRef.current?.scrollIntoView({
				behavior: "smooth",
			});
		}, [messages]);

		// ── Session persistence helpers ──

		const createSession = useCallback(
			async (title: string): Promise<string> => {
				const body: Record<string, string> = { title };
				if (filePath) {
					body.filePath = filePath;
				}
				const res = await fetch("/api/web-sessions", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
				const data = await res.json();
				return data.session.id;
			},
			[filePath],
		);

		const saveMessages = useCallback(
			async (
				sessionId: string,
				msgs: Array<{
					id: string;
					role: string;
					content: string;
					parts?: unknown[];
				}>,
				title?: string,
			) => {
				const toSave = msgs.map((m) => ({
					id: m.id,
					role: m.role,
					content: m.content,
					...(m.parts ? { parts: m.parts } : {}),
					timestamp: new Date().toISOString(),
				}));
				try {
					await fetch(
						`/api/web-sessions/${sessionId}/messages`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								messages: toSave,
								title,
							}),
						},
					);
					for (const m of msgs) {
						savedMessageIdsRef.current.add(m.id);
					}
					onSessionsChange?.();
				} catch (err) {
					console.error("Failed to save messages:", err);
				}
			},
			[onSessionsChange],
		);

		/** Extract plain text from a UIMessage */
		const getMessageText = useCallback(
			(msg: (typeof messages)[number]): string => {
				return (
					msg.parts
						?.filter(
							(
								p,
							): p is {
								type: "text";
								text: string;
							} => p.type === "text",
						)
						.map((p) => p.text)
						.join("\n") ?? ""
				);
			},
			[],
		);

		// ── File-scoped session initialization ──
		const fetchFileSessionsRef = useRef<
			(() => Promise<FileScopedSession[]>) | null
		>(null);

		fetchFileSessionsRef.current = async () => {
			if (!filePath) {
				return [];
			}
			try {
				const res = await fetch(
					`/api/web-sessions?filePath=${encodeURIComponent(filePath)}`,
				);
				const data = await res.json();
				return (data.sessions || []) as FileScopedSession[];
			} catch {
				return [];
			}
		};

		useEffect(() => {
			if (!filePath) {
				return;
			}
			let cancelled = false;

			sessionIdRef.current = null;
			setCurrentSessionId(null);
			onActiveSessionChange?.(null);
			setMessages([]);
			savedMessageIdsRef.current.clear();
			isFirstFileMessageRef.current = true;

			(async () => {
				const sessions =
					(await fetchFileSessionsRef.current?.()) ?? [];
				if (cancelled) {
					return;
				}
				setFileSessions(sessions);

				if (sessions.length > 0) {
					const latest = sessions[0];
					setCurrentSessionId(latest.id);
					sessionIdRef.current = latest.id;
					onActiveSessionChange?.(latest.id);
					isFirstFileMessageRef.current = false;

					try {
						const msgRes = await fetch(
							`/api/web-sessions/${latest.id}`,
						);
						if (cancelled) {
							return;
						}
						const msgData = await msgRes.json();
						const sessionMessages: Array<{
							id: string;
							role: "user" | "assistant";
							content: string;
							parts?: Array<Record<string, unknown>>;
						}> = msgData.messages || [];

						const uiMessages = sessionMessages.map(
							(msg) => {
								savedMessageIdsRef.current.add(msg.id);
								return {
									id: msg.id,
									role: msg.role,
									parts: (msg.parts ?? [
										{
											type: "text" as const,
											text: msg.content,
										},
									]) as UIMessage["parts"],
								};
							},
						);
						if (!cancelled) {
							setMessages(uiMessages);
						}
					} catch {
						// ignore
					}
				}
			})();

			return () => {
				cancelled = true;
			};
			// eslint-disable-next-line react-hooks/exhaustive-deps -- stable setters
		}, [filePath]);

		// ── Persist unsaved messages + live-reload after streaming ──
		const prevStatusRef = useRef(status);
		useEffect(() => {
			const wasStreaming =
				prevStatusRef.current === "streaming" ||
				prevStatusRef.current === "submitted";
			const isNowReady = status === "ready";

			if (wasStreaming && isNowReady && currentSessionId) {
				const unsaved = messages.filter(
					(m) => !savedMessageIdsRef.current.has(m.id),
				);
				if (unsaved.length > 0) {
					const toSave = unsaved.map((m) => ({
						id: m.id,
						role: m.role,
						content: getMessageText(m),
						parts: m.parts,
					}));
					saveMessages(currentSessionId, toSave);
				}

				if (filePath) {
					fetchFileSessionsRef.current?.().then(
						(sessions) => {
							setFileSessions(sessions);
						},
					);
				}

				if (filePath && onFileChanged) {
					fetch(
						`/api/workspace/file?path=${encodeURIComponent(filePath)}`,
					)
						.then((r) => r.json())
						.then((data) => {
							if (data.content) {
								onFileChanged(data.content);
							}
						})
						.catch(() => {});
				}
			}
			prevStatusRef.current = status;
		}, [
			status,
			messages,
			currentSessionId,
			saveMessages,
			getMessageText,
			filePath,
			onFileChanged,
		]);

		// ── Actions ──

		const handleSubmit = async (e: React.FormEvent) => {
			e.preventDefault();
			if (!input.trim() || isStreaming) {
				return;
			}

			const userText = input.trim();
			setInput("");

			if (userText.toLowerCase() === "/new") {
				handleNewSession();
				return;
			}

			let sessionId = currentSessionId;
			if (!sessionId) {
				const title =
					userText.length > 60
						? userText.slice(0, 60) + "..."
						: userText;
				sessionId = await createSession(title);
				setCurrentSessionId(sessionId);
				sessionIdRef.current = sessionId;
				onActiveSessionChange?.(sessionId);
				onSessionsChange?.();

				if (filePath) {
					fetchFileSessionsRef.current?.().then(
						(sessions) => {
							setFileSessions(sessions);
						},
					);
				}
			}

			let messageText = userText;
			if (fileContext && isFirstFileMessageRef.current) {
				messageText = `[Context: workspace file '${fileContext.path}']\n\n${userText}`;
				isFirstFileMessageRef.current = false;
			}

			sendMessage({ text: messageText });
		};

		const handleSessionSelect = useCallback(
			async (sessionId: string) => {
				if (sessionId === currentSessionId) {
					return;
				}

				stop();
				setLoadingSession(true);
				setCurrentSessionId(sessionId);
				sessionIdRef.current = sessionId;
				onActiveSessionChange?.(sessionId);
				savedMessageIdsRef.current.clear();
				isFirstFileMessageRef.current = false;

				try {
					const response = await fetch(
						`/api/web-sessions/${sessionId}`,
					);
					if (!response.ok) {
						throw new Error("Failed to load session");
					}

					const data = await response.json();
					const sessionMessages: Array<{
						id: string;
						role: "user" | "assistant";
						content: string;
						parts?: Array<Record<string, unknown>>;
					}> = data.messages || [];

					const uiMessages = sessionMessages.map((msg) => {
						savedMessageIdsRef.current.add(msg.id);
						return {
							id: msg.id,
							role: msg.role,
							parts: (msg.parts ?? [
								{
									type: "text" as const,
									text: msg.content,
								},
							]) as UIMessage["parts"],
						};
					});

					setMessages(uiMessages);
				} catch (err) {
					console.error("Error loading session:", err);
				} finally {
					setLoadingSession(false);
				}
			},
			[
				currentSessionId,
				setMessages,
				onActiveSessionChange,
				stop,
			],
		);

		const handleNewSession = useCallback(async () => {
			stop();
			setCurrentSessionId(null);
			sessionIdRef.current = null;
			onActiveSessionChange?.(null);
			setMessages([]);
			savedMessageIdsRef.current.clear();
			isFirstFileMessageRef.current = true;
			newSessionPendingRef.current = false;

			if (!filePath) {
				setStartingNewSession(true);
				try {
					await fetch("/api/new-session", {
						method: "POST",
					});
				} catch (err) {
					console.error("Failed to send /new:", err);
				} finally {
					setStartingNewSession(false);
				}
			}
		}, [setMessages, onActiveSessionChange, filePath, stop]);

		useImperativeHandle(
			ref,
			() => ({
				loadSession: handleSessionSelect,
				newSession: handleNewSession,
			}),
			[handleSessionSelect, handleNewSession],
		);

		// ── Status label ──

		const statusLabel = startingNewSession
			? "Starting new session..."
			: loadingSession
				? "Loading session..."
				: status === "ready"
					? "Ready"
					: status === "submitted"
						? "Thinking..."
						: status === "streaming"
							? "Streaming..."
							: status === "error"
								? "Error"
								: status;

		// ── Render ──

		return (
			<div className="flex flex-col h-full">
				{/* Header */}
				<header
					className={`${compact ? "px-3 py-2" : "px-6 py-3"} border-b flex items-center justify-between flex-shrink-0`}
					style={{
						borderColor: "var(--color-border)",
						background: "var(--color-surface)",
					}}
				>
					<div className="min-w-0 flex-1">
						{compact && fileContext ? (
							<>
								<h2
									className="text-xs font-semibold truncate"
									style={{
										color: "var(--color-text)",
									}}
								>
									Chat: {fileContext.filename}
								</h2>
								<p
									className="text-[10px]"
									style={{
										color: "var(--color-text-muted)",
									}}
								>
									{statusLabel}
								</p>
							</>
						) : (
							<>
								<h2
									className="text-sm font-semibold"
									style={{
										color: "var(--color-text)",
									}}
								>
									{currentSessionId
										? "Chat Session"
										: "New Chat"}
								</h2>
								<p
									className="text-xs"
									style={{
										color: "var(--color-text-muted)",
									}}
								>
									{statusLabel}
								</p>
							</>
						)}
					</div>
					<div className="flex gap-1 flex-shrink-0">
						{compact && (
							<button
								type="button"
								onClick={() => handleNewSession()}
								className="p-1.5 rounded-lg"
								style={{
									color: "var(--color-text-muted)",
								}}
								title="New chat"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M12 5v14" />
									<path d="M5 12h14" />
								</svg>
							</button>
						)}
						{isStreaming && (
							<button
								type="button"
								onClick={() => stop()}
								className={`${compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs"} rounded-full font-medium`}
								style={{
									background:
										"var(--color-surface-hover)",
									color: "var(--color-text)",
									border: "1px solid var(--color-border)",
								}}
							>
								Stop
							</button>
						)}
					</div>
				</header>

				{/* File-scoped session tabs (compact mode) */}
				{compact && fileContext && fileSessions.length > 0 && (
					<div
						className="px-2 py-1.5 border-b flex gap-1 overflow-x-auto flex-shrink-0"
						style={{
							borderColor: "var(--color-border)",
						}}
					>
						{fileSessions.slice(0, 10).map((s) => (
							<button
								key={s.id}
								type="button"
								onClick={() =>
									handleSessionSelect(s.id)
								}
								className="px-2.5 py-1 text-[10px] rounded-full whitespace-nowrap flex-shrink-0 font-medium"
								style={{
									background:
										s.id === currentSessionId
											? "var(--color-accent)"
											: "var(--color-surface-hover)",
									color:
										s.id === currentSessionId
											? "white"
											: "var(--color-text-muted)",
									border:
										s.id === currentSessionId
											? "none"
											: "1px solid var(--color-border)",
								}}
							>
								{s.title.length > 25
									? s.title.slice(0, 25) + "..."
									: s.title}
							</button>
						))}
					</div>
				)}

				{/* Messages */}
				<div
					className={`flex-1 overflow-y-auto ${compact ? "px-3" : "px-6"}`}
				>
					{loadingSession ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center">
								<div
									className="w-6 h-6 border-2 rounded-full animate-spin mx-auto mb-3"
									style={{
										borderColor:
											"var(--color-border)",
										borderTopColor:
											"var(--color-accent)",
									}}
								/>
								<p
									className="text-xs"
									style={{
										color: "var(--color-text-muted)",
									}}
								>
									Loading session...
								</p>
							</div>
						</div>
					) : messages.length === 0 ? (
						<div className="flex items-center justify-center h-full">
							<div className="text-center max-w-md px-4">
								{compact ? (
									<p
										className="text-sm"
										style={{
											color: "var(--color-text-muted)",
										}}
									>
										Ask about this file
									</p>
								) : (
									<>
										<h3
											className="font-instrument text-3xl tracking-tight mb-2"
											style={{
												color: "var(--color-text)",
											}}
										>
											What can I help with?
										</h3>
										<p
											className="text-sm leading-relaxed"
											style={{
												color: "var(--color-text-muted)",
											}}
										>
											Send a message to start a
											conversation with your
											agent.
										</p>
									</>
								)}
							</div>
						</div>
					) : (
						<div
							className={`${compact ? "" : "max-w-3xl mx-auto"} py-3`}
						>
							{messages.map((message) => (
								<ChatMessage
									key={message.id}
									message={message}
								/>
							))}
							<div ref={messagesEndRef} />
						</div>
					)}
				</div>

				{/* Transport-level error display */}
				{error && (
					<div
						className="px-3 py-2 border-t flex-shrink-0 flex items-center gap-2"
						style={{
							background: `color-mix(in srgb, var(--color-error) 6%, var(--color-surface))`,
							borderColor: `color-mix(in srgb, var(--color-error) 18%, transparent)`,
							color: "var(--color-error)",
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="flex-shrink-0"
						>
							<circle cx="12" cy="12" r="10" />
							<line
								x1="12"
								y1="8"
								x2="12"
								y2="12"
							/>
							<line
								x1="12"
								y1="16"
								x2="12.01"
								y2="16"
							/>
						</svg>
						<p className="text-xs">{error.message}</p>
					</div>
				)}

				{/* Input — Dench-style rounded area with toolbar */}
				<div
					className={`${compact ? "px-3 py-2" : "px-6 py-4"} flex-shrink-0`}
					style={{ background: "var(--color-bg)" }}
				>
					<div
						className={`${compact ? "" : "max-w-3xl mx-auto"}`}
					>
						<div
							className="rounded-2xl overflow-hidden"
							style={{
								background:
									"var(--color-chat-input-bg)",
								border: "1px solid var(--color-border)",
							}}
						>
							<form onSubmit={handleSubmit}>
								<input
									type="text"
									value={input}
									onChange={(e) =>
										setInput(e.target.value)
									}
									placeholder={
										compact && fileContext
											? `Ask about ${fileContext.filename}...`
											: "Ask anything..."
									}
									disabled={
										isStreaming ||
										loadingSession ||
										startingNewSession
									}
									className={`w-full ${compact ? "px-3 py-2.5 text-xs" : "px-4 py-3.5 text-sm"} bg-transparent outline-none placeholder:text-[var(--color-text-muted)] disabled:opacity-50`}
									style={{
										color: "var(--color-text)",
									}}
								/>
							</form>
							{/* Toolbar row */}
							<div
								className={`flex items-center justify-between ${compact ? "px-2 pb-1.5" : "px-3 pb-2.5"}`}
							>
								<div className="flex items-center gap-0.5">
									{/* Placeholder toolbar icons */}
									<button
										type="button"
										className="p-1.5 rounded-lg"
										style={{
											color: "var(--color-text-muted)",
										}}
										title="Attach"
									>
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
										</svg>
									</button>
								</div>
								{/* Send button */}
								<button
									type="submit"
									onClick={handleSubmit}
									disabled={
										!input.trim() ||
										isStreaming ||
										loadingSession ||
										startingNewSession
									}
									className={`${compact ? "w-6 h-6" : "w-7 h-7"} rounded-full flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed`}
									style={{
										background:
											input.trim()
												? "var(--color-accent)"
												: "var(--color-border-strong)",
										color: "white",
									}}
								>
									{isStreaming ? (
										<div
											className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"
										/>
									) : (
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2.5"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<path d="M12 19V5" />
											<path d="m5 12 7-7 7 7" />
										</svg>
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	},
);
