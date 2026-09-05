with open('static/styles.css', 'a', encoding='utf-8') as f:
    f.write('''\n
/* --- GLOBAL FEEDBACK TRACKER (BEFORE & AFTER) --- */
.diff-card {
    background: rgba(17, 24, 39, 0.5);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-md);
    padding: 15px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.diff-header {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-main);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.diff-agent-badge {
    background: rgba(99, 102, 241, 0.2);
    color: var(--primary);
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 11px;
    text-transform: uppercase;
}

.diff-content {
    display: flex;
    gap: 15px;
    margin-top: 5px;
}

.diff-before, .diff-after {
    flex: 1;
    padding: 12px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    line-height: 1.5;
}

.diff-before {
    background: rgba(244, 63, 94, 0.05);
    border-left: 3px solid var(--rose);
    color: var(--text-muted);
    text-decoration: line-through;
}

.diff-after {
    background: rgba(16, 185, 129, 0.05);
    border-left: 3px solid var(--emerald);
    color: #D1D5DB;
}

.diff-highlight {
    background: rgba(16, 185, 129, 0.2);
    color: #fff;
    padding: 0 3px;
    border-radius: 2px;
}
''')
