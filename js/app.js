/**
 * app.js
 * Application controller, view router, modal coordinator, and state orchestration.
 * Updated to interact asynchronously with the Node.js + Express + SQLite backend.
 */

import { renderAnalyticsView } from './analytics.js';
import { renderAiAnalyzerView } from './ai-analyzer.js';
import { renderBudgetView } from './budget.js';
import { renderDashboardView } from './dashboard.js';
import {
  addTransaction,
  analyzeExpenses,
  askAiAboutSpending,
  deleteTransaction,
  ensureInitialized,
  getAiStatus,
  getMonthlyBudget,
  getTransactions,
  resetSampleData,
  saveMonthlyBudget,
  updateTransaction,
} from './storage.js';
import {
  bindTransactionForm,
  buildTransactionFormMarkup,
  escapeHtml,
  exportTransactionsCsv,
  getCurrentMonthKey,
  refreshIcons,
  renderAddTransactionView,
  renderTransactionsView,
} from './transactions.js';

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  'add-transaction': 'Add Entry',
  transactions: 'Transactions',
  analytics: 'Analytics',
  budget: 'Budget',
  ai: 'AI Analyzer',
};

const state = {
  activeView: 'dashboard',
  activeMonth: getCurrentMonthKey(),
  analyticsPeriod: 'month',
  filters: {
    search: '',
    category: 'all',
    type: 'all',
    sortBy: 'date-desc',
  },
  transactions: [],
  monthlyBudget: 0,
  isLoading: false,
  error: null,
  ai: {
    status: null,
    analysis: null,
    meta: null,
    isAnalyzing: false,
    isAsking: false,
    error: null,
    period: 'month',
    answer: null,
    question: '',
  },
};

const dom = {
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  openSidebarBtn: document.getElementById('open-sidebar-btn'),
  closeSidebarBtn: document.getElementById('close-sidebar-btn'),
  topbarTitle: document.getElementById('topbar-title'),
  globalMonthPicker: document.getElementById('global-month-picker'),
  topbarAddBtn: document.getElementById('topbar-add-btn'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  resetSampleBtn: document.getElementById('reset-sample-btn'),
  txModal: document.getElementById('transaction-modal'),
  txModalTitle: document.getElementById('modal-title'),
  txModalBody: document.getElementById('modal-body'),
  txModalCloseBtn: document.getElementById('modal-close-btn'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmCloseBtn: document.getElementById('confirm-close-btn'),
  confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
  confirmAcceptBtn: document.getElementById('confirm-accept-btn'),
  toastContainer: document.getElementById('toast-container'),
  views: {
    dashboard: document.getElementById('view-dashboard'),
    'add-transaction': document.getElementById('view-add-transaction'),
    transactions: document.getElementById('view-transactions'),
    analytics: document.getElementById('view-analytics'),
    budget: document.getElementById('view-budget'),
    ai: document.getElementById('view-ai'),
  },
};

let confirmResolver = null;

/**
 * Displays a brief accessible toast notification.
 * @param {string} message
 * @param {'success'|'error'} variant
 */
function showToast(message, variant = 'success') {
  if (!dom.toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${variant === 'error' ? 'is-error' : ''}`;
  toast.innerHTML = `
    <i data-lucide="${variant === 'error' ? 'alert-circle' : 'check-circle-2'}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  dom.toastContainer.appendChild(toast);
  refreshIcons();

  window.setTimeout(() => {
    toast.remove();
  }, 3000);
}

/**
 * Syncs in-memory application state from the backend API.
 */
async function loadStateFromStorage() {
  state.isLoading = true;
  state.error = null;
  try {
    const [txList, budget] = await Promise.all([
      getTransactions(),
      getMonthlyBudget(state.activeMonth),
    ]);
    state.transactions = txList;
    state.monthlyBudget = budget;
    state.error = null;
  } catch (err) {
    console.error('Failed to load data from backend:', err);
    state.error = err.message || 'Unable to connect to the backend server.';
    showToast(state.error, 'error');
  } finally {
    state.isLoading = false;
  }
}

/**
 * Opens or closes the mobile navigation drawer.
 * @param {boolean} open
 */
function setMobileSidebar(open) {
  if (!dom.sidebar || !dom.sidebarBackdrop) return;
  dom.sidebar.classList.toggle('is-open', open);
  dom.sidebarBackdrop.hidden = !open;
}

/**
 * Loads the AI provider configuration (used to show the correct banner).
 */
async function loadAiStatus() {
  try {
    state.ai.status = await getAiStatus();
  } catch (err) {
    console.warn('Could not read AI provider status:', err);
    state.ai.status = null;
  }
}

/**
 * Requests an AI analysis for the selected period and stores the result.
 * @param {{ refresh?: boolean }} options
 */
async function runAiAnalysis(options = {}) {
  if (state.ai.isAnalyzing) return;

  state.ai.isAnalyzing = true;
  state.ai.error = null;
  renderActiveView();

  try {
    const { analysis, meta } = await analyzeExpenses({
      period: state.ai.period,
      month: state.activeMonth,
      refresh: options.refresh === true,
    });

    state.ai.analysis = analysis;
    state.ai.meta = meta;
    state.ai.answer = null;
  } catch (err) {
    console.error('AI analysis failed:', err);
    state.ai.error = err.message || 'Unable to run the analysis.';
    showToast(state.ai.error, 'error');
  } finally {
    state.ai.isAnalyzing = false;
    renderActiveView();
  }
}

/**
 * Ensures the AI view has a status and an analysis ready to display.
 */
async function ensureAiReady() {
  if (!state.ai.status) await loadAiStatus();
  if (!state.ai.analysis && !state.ai.isAnalyzing) {
    await runAiAnalysis();
  }
}

/**
 * Sends a free-form question about the recorded spending to the AI service.
 * @param {string} question
 */
async function askAi(question) {
  const value = String(question || '').trim();
  if (!value || state.ai.isAsking) return;

  state.ai.question = value;
  state.ai.isAsking = true;
  renderActiveView();

  try {
    state.ai.answer = await askAiAboutSpending(value, {
      period: state.ai.period,
      month: state.activeMonth,
    });
  } catch (err) {
    console.error('AI question failed:', err);
    showToast(err.message || 'Could not answer the question.', 'error');
  } finally {
    state.ai.isAsking = false;
    renderActiveView();
    focusAiQuestionInput();
  }
}

/**
 * Restores focus to the question input after the view re-renders.
 */
function focusAiQuestionInput() {
  const input = dom.views.ai?.querySelector('#ai-question-input');
  if (!input) return;
  input.focus();
  const length = input.value.length;
  input.setSelectionRange(length, length);
}

/**
 * Drops the cached AI analysis so the next visit recomputes it from the
 * current ledger contents.
 */
function invalidateAiAnalysis() {
  state.ai.analysis = null;
  state.ai.meta = null;
  state.ai.answer = null;
  state.ai.error = null;
}

/**
 * Switches the active workspace section and updates URL hash.
 * @param {string} viewKey
 */
function navigateTo(viewKey) {
  const nextView = Object.prototype.hasOwnProperty.call(dom.views, viewKey)
    ? viewKey
    : 'dashboard';

  state.activeView = nextView;

  if (window.location.hash !== `#${nextView}`) {
    history.replaceState(null, '', `#${nextView}`);
  }

  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('is-active', el.getAttribute('data-nav') === nextView);
  });

  if (dom.topbarTitle) {
    dom.topbarTitle.textContent = VIEW_TITLES[nextView] || 'Dashboard';
  }

  Object.entries(dom.views).forEach(([key, section]) => {
    if (section) section.hidden = key !== nextView;
  });

  setMobileSidebar(false);
  renderActiveView();

  // The AI analyzer loads its own data on first visit.
  if (nextView === 'ai') {
    ensureAiReady();
  }
}

/**
 * Opens a confirmation modal and returns a Promise resolving to boolean.
 * @param {{ title: string, message: string, confirmLabel?: string }} options
 * @returns {Promise<boolean>}
 */
function openConfirmDialog({ title, message, confirmLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.confirmAcceptBtn.textContent = confirmLabel;
    dom.confirmModal.hidden = false;
    dom.confirmAcceptBtn.focus();
  });
}

function closeConfirmDialog(accepted) {
  dom.confirmModal.hidden = true;
  if (typeof confirmResolver === 'function') {
    const fn = confirmResolver;
    confirmResolver = null;
    fn(Boolean(accepted));
  }
}

/**
 * Opens the Add or Edit Transaction modal.
 * @param {'add'|'edit'} mode
 * @param {object|null} txData
 */
function openTransactionModal(mode, txData = null) {
  dom.txModalTitle.textContent = mode === 'edit' ? 'Edit Transaction' : 'Add Transaction';
  dom.txModalBody.innerHTML = buildTransactionFormMarkup({
    mode,
    initialData: txData || {},
    formId: 'modal-tx-form',
    showCancel: true,
  });

  dom.txModal.hidden = false;
  refreshIcons();

  const formEl = dom.txModalBody.querySelector('#modal-tx-form');
  const titleInput = formEl?.querySelector('input[name="title"]');
  if (titleInput) titleInput.focus();

  bindTransactionForm(formEl, {
    onCancel: closeTransactionModal,
    onSubmit: async (normalized) => {
      try {
        if (mode === 'edit' && txData?.id) {
          await updateTransaction(txData.id, normalized);
          showToast('Transaction updated.');
        } else {
          await addTransaction(normalized);
          showToast('Transaction added.');
        }
        closeTransactionModal();
        invalidateAiAnalysis();
        await loadStateFromStorage();
        renderActiveView();
      } catch (err) {
        showToast(err.message || 'Could not save transaction.', 'error');
      }
    },
  });
}

function closeTransactionModal() {
  dom.txModal.hidden = true;
  dom.txModalBody.innerHTML = '';
}

/**
 * Handles deleting a transaction with confirmation.
 * @param {number|string} txId
 */
async function handleDeleteTransaction(txId) {
  const target = state.transactions.find((t) => String(t.id) === String(txId));
  if (!target) return;

  const confirmed = await openConfirmDialog({
    title: 'Delete Transaction',
    message: `Are you sure you want to delete "${target.title}"? This action cannot be undone.`,
    confirmLabel: 'Delete',
  });

  if (!confirmed) return;

  try {
    await deleteTransaction(txId);
    invalidateAiAnalysis();
    await loadStateFromStorage();
    renderActiveView();
    showToast('Transaction deleted.');
  } catch (err) {
    showToast(err.message || 'Unable to delete transaction.', 'error');
  }
}

/**
 * Handles opening the edit modal for a specific transaction ID.
 * @param {number|string} txId
 */
function handleEditRequest(txId) {
  const target = state.transactions.find((t) => String(t.id) === String(txId));
  if (!target) {
    showToast('Transaction not found.', 'error');
    return;
  }
  openTransactionModal('edit', target);
}

/**
 * Renders whichever workspace view is currently active.
 */
function renderActiveView() {
  const container = dom.views[state.activeView];
  if (!container) return;

  // Render loading state if initial/background fetch is in flight
  if (state.isLoading && state.transactions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="database"></i></div>
        <h3 class="empty-state-title">Loading LedgerFlow data...</h3>
        <p class="empty-state-desc">Connecting to SQLite database</p>
      </div>
    `;
    refreshIcons();
    return;
  }

  // Render visible error banner if connection or backend failed
  if (state.error && state.transactions.length === 0) {
    container.innerHTML = `
      <div class="status-banner is-exceeded" style="margin-bottom: 24px;">
        <div class="status-banner-main">
          <i data-lucide="alert-circle"></i>
          <div>
            <div class="status-banner-title">Unable to Connect to Server</div>
            <div class="status-banner-desc">${escapeHtml(state.error)}</div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="retry-connection">Retry</button>
      </div>
    `;
    container.onclick = async (e) => {
      const btn = e.target.closest('[data-action="retry-connection"]');
      if (btn) {
        await loadStateFromStorage();
        renderActiveView();
      }
    };
    refreshIcons();
    return;
  }

  const sharedCallbacks = {
    onNavigate: navigateTo,
    onAddRequest: () => openTransactionModal('add'),
    onEditRequest: handleEditRequest,
    onDeleteRequest: handleDeleteTransaction,
  };

  switch (state.activeView) {
    case 'dashboard':
      renderDashboardView(
        container,
        state.transactions,
        state.activeMonth,
        state.monthlyBudget,
        sharedCallbacks
      );
      break;

    case 'add-transaction':
      renderAddTransactionView(container, {
        onCreate: async (normalized) => {
          try {
            await addTransaction(normalized);
            invalidateAiAnalysis();
            await loadStateFromStorage();
            showToast('Transaction saved.');
            navigateTo('dashboard');
          } catch (err) {
            showToast(err.message || 'Could not save transaction.', 'error');
          }
        },
      });
      break;

    case 'transactions':
      renderTransactionsView(container, state.transactions, state.filters, {
        ...sharedCallbacks,
        onFilterChange: (patch, opts = {}) => {
          state.filters = { ...state.filters, ...patch };
          if (!opts.skipFullRender) {
            renderActiveView();
          }
        },
        onResetFilters: () => {
          state.filters = {
            search: '',
            category: 'all',
            type: 'all',
            sortBy: 'date-desc',
          };
          renderActiveView();
        },
      });
      break;

    case 'analytics':
      renderAnalyticsView(
        container,
        state.transactions,
        state.activeMonth,
        state.analyticsPeriod,
        {
          onPeriodChange: (nextPeriod) => {
            state.analyticsPeriod = nextPeriod;
            renderActiveView();
          },
        }
      );
      break;

    case 'budget':
      renderBudgetView(
        container,
        state.transactions,
        state.activeMonth,
        state.monthlyBudget,
        {
          onSaveBudget: async (monthKey, limit) => {
            try {
              await saveMonthlyBudget(monthKey, limit);
              await loadStateFromStorage();
              renderActiveView();
              showToast('Monthly budget updated.');
            } catch (err) {
              showToast(err.message || 'Could not update budget.', 'error');
            }
          },
        }
      );
      break;

    case 'ai':
      renderAiAnalyzerView(
        container,
        {
          analysis: state.ai.analysis,
          meta: state.ai.meta,
          status: state.ai.status,
          isAnalyzing: state.ai.isAnalyzing,
          isAsking: state.ai.isAsking,
          error: state.ai.error,
          period: state.ai.period,
          activeMonth: state.activeMonth,
          answer: state.ai.answer,
          question: state.ai.question,
        },
        {
          onAnalyze: (options) => runAiAnalysis(options),
          onPeriodChange: (period) => {
            state.ai.period = period;
            state.ai.analysis = null;
            state.ai.answer = null;
            runAiAnalysis();
          },
          onAsk: (question) => askAi(question),
        }
      );
      break;
  }
}

/**
 * Wires global shell events (navigation, month picker, modals, shortcuts).
 */
function bindGlobalListeners() {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = el.getAttribute('data-nav');
      if (targetView) navigateTo(targetView);
    });
  });

  if (dom.openSidebarBtn) {
    dom.openSidebarBtn.addEventListener('click', () => setMobileSidebar(true));
  }
  if (dom.closeSidebarBtn) {
    dom.closeSidebarBtn.addEventListener('click', () => setMobileSidebar(false));
  }
  if (dom.sidebarBackdrop) {
    dom.sidebarBackdrop.addEventListener('click', () => setMobileSidebar(false));
  }

  if (dom.globalMonthPicker) {
    dom.globalMonthPicker.value = state.activeMonth;
    dom.globalMonthPicker.addEventListener('change', async (e) => {
      if (e.target.value) {
        state.activeMonth = e.target.value;
        state.monthlyBudget = await getMonthlyBudget(state.activeMonth);
        invalidateAiAnalysis();
        renderActiveView();
      }
    });
  }

  if (dom.topbarAddBtn) {
    dom.topbarAddBtn.addEventListener('click', () => openTransactionModal('add'));
  }

  if (dom.exportCsvBtn) {
    dom.exportCsvBtn.addEventListener('click', () => {
      if (state.transactions.length === 0) {
        showToast('No transactions to export.', 'error');
        return;
      }
      exportTransactionsCsv(state.transactions);
      showToast('CSV exported.');
    });
  }

  if (dom.resetSampleBtn) {
    dom.resetSampleBtn.addEventListener('click', async () => {
      const confirmed = await openConfirmDialog({
        title: 'Reset Sample Data',
        message:
          'Restore the default sample transactions and monthly budget? Any custom entries will be replaced.',
        confirmLabel: 'Reset Data',
      });
      if (!confirmed) return;

      try {
        await resetSampleData();
        state.activeMonth = getCurrentMonthKey();
        if (dom.globalMonthPicker) dom.globalMonthPicker.value = state.activeMonth;
        invalidateAiAnalysis();
        await loadStateFromStorage();
        renderActiveView();
        showToast('Sample data restored.');
      } catch (err) {
        showToast(err.message || 'Could not reset sample data.', 'error');
      }
    });
  }

  if (dom.txModalCloseBtn) {
    dom.txModalCloseBtn.addEventListener('click', closeTransactionModal);
  }
  if (dom.txModal) {
    dom.txModal.addEventListener('click', (e) => {
      if (e.target === dom.txModal) closeTransactionModal();
    });
  }

  if (dom.confirmCloseBtn) {
    dom.confirmCloseBtn.addEventListener('click', () => closeConfirmDialog(false));
  }
  if (dom.confirmCancelBtn) {
    dom.confirmCancelBtn.addEventListener('click', () => closeConfirmDialog(false));
  }
  if (dom.confirmAcceptBtn) {
    dom.confirmAcceptBtn.addEventListener('click', () => closeConfirmDialog(true));
  }
  if (dom.confirmModal) {
    dom.confirmModal.addEventListener('click', (e) => {
      if (e.target === dom.confirmModal) closeConfirmDialog(false);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.confirmModal.hidden) closeConfirmDialog(false);
      else if (!dom.txModal.hidden) closeTransactionModal();
      else setMobileSidebar(false);
    }
  });

  window.addEventListener('hashchange', () => {
    const hashView = window.location.hash.replace('#', '');
    if (hashView && hashView !== state.activeView && dom.views[hashView]) {
      navigateTo(hashView);
    }
  });
}

/**
 * Initializes the application on DOM ready.
 */
async function init() {
  bindGlobalListeners();

  const initialHash = window.location.hash.replace('#', '');
  const initialView = initialHash && dom.views[initialHash] ? initialHash : 'dashboard';
  navigateTo(initialView);

  try {
    await ensureInitialized();
  } catch (err) {
    console.warn('Initial data check notice:', err);
  }

  await loadStateFromStorage();
  renderActiveView();
  refreshIcons();
}

init();
