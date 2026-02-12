"use client";

import { useEffect, useState } from "react";
import { FileManagerTree, type TreeNode } from "./file-manager-tree";

type WorkspaceSidebarProps = {
	tree: TreeNode[];
	activePath: string | null;
	onSelect: (node: TreeNode) => void;
	onRefresh: () => void;
	orgName?: string;
	loading?: boolean;
};

function WorkspaceLogo() {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect width="7" height="7" x="3" y="3" rx="1" />
			<rect width="7" height="7" x="14" y="3" rx="1" />
			<rect width="7" height="7" x="14" y="14" rx="1" />
			<rect width="7" height="7" x="3" y="14" rx="1" />
		</svg>
	);
}

function HomeIcon() {
	return (
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
			<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
			<polyline points="9 22 9 12 15 12 15 22" />
		</svg>
	);
}

/* ─── Theme toggle ─── */

function ThemeToggle() {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		setIsDark(document.documentElement.classList.contains("dark"));
	}, []);

	const toggle = () => {
		const next = !isDark;
		setIsDark(next);
		if (next) {
			document.documentElement.classList.add("dark");
			localStorage.setItem("theme", "dark");
		} else {
			document.documentElement.classList.remove("dark");
			localStorage.setItem("theme", "light");
		}
	};

	return (
		<button
			type="button"
			onClick={toggle}
			className="p-1.5 rounded-lg"
			style={{ color: "var(--color-text-muted)" }}
			title={isDark ? "Switch to light mode" : "Switch to dark mode"}
		>
			{isDark ? (
				/* Sun icon */
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
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2" />
					<path d="M12 20v2" />
					<path d="m4.93 4.93 1.41 1.41" />
					<path d="m17.66 17.66 1.41 1.41" />
					<path d="M2 12h2" />
					<path d="M20 12h2" />
					<path d="m6.34 17.66-1.41 1.41" />
					<path d="m19.07 4.93-1.41 1.41" />
				</svg>
			) : (
				/* Moon icon */
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
					<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
				</svg>
			)}
		</button>
	);
}

export function WorkspaceSidebar({
	tree,
	activePath,
	onSelect,
	onRefresh,
	orgName,
	loading,
}: WorkspaceSidebarProps) {
	return (
		<aside
			className="flex flex-col h-screen border-r flex-shrink-0"
			style={{
				width: "260px",
				background: "var(--color-surface)",
				borderColor: "var(--color-border)",
			}}
		>
			{/* Header */}
			<div
				className="flex items-center gap-2.5 px-4 py-3 border-b"
				style={{ borderColor: "var(--color-border)" }}
			>
				<span
					className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
					style={{
						background: "var(--color-accent-light)",
						color: "var(--color-accent)",
					}}
				>
					<WorkspaceLogo />
				</span>
				<div className="flex-1 min-w-0">
					<div
						className="text-sm font-medium truncate"
						style={{ color: "var(--color-text)" }}
					>
						{orgName || "Workspace"}
					</div>
					<div
						className="text-[11px]"
						style={{
							color: "var(--color-text-muted)",
						}}
					>
						Dench CRM
					</div>
				</div>
			</div>

			{/* Tree */}
			<div className="flex-1 overflow-y-auto px-1">
				{loading ? (
					<div className="flex items-center justify-center py-12">
						<div
							className="w-5 h-5 border-2 rounded-full animate-spin"
							style={{
								borderColor: "var(--color-border)",
								borderTopColor:
									"var(--color-accent)",
							}}
						/>
					</div>
				) : (
					<FileManagerTree
						tree={tree}
						activePath={activePath}
						onSelect={onSelect}
						onRefresh={onRefresh}
					/>
				)}
			</div>

			{/* Footer */}
			<div
				className="px-3 py-2.5 border-t flex items-center justify-between"
				style={{ borderColor: "var(--color-border)" }}
			>
				<a
					href="/"
					className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm"
					style={{ color: "var(--color-text-muted)" }}
				>
					<HomeIcon />
					Home
				</a>
				<ThemeToggle />
			</div>
		</aside>
	);
}
