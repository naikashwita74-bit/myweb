/**
 * app.js
 * Application controller, view router, modal coordinator, and state orchestration.
 */

import { renderAnalyticsView } from './analytics.js';
import { renderBudgetView } from './budget.js';
import { renderDashboardView } from './dashboard.js';
import {
  addTransaction,
  deleteTransaction,
  ensureInitialized,
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
 * Syncs in-memory application state from the storage layer.
 */
function loadStateFromStorage() {
  state.transactions = getTransactions();
  state.monthlyBudget = getMonthlyBudget(state.activeMonth);
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
    onSubmit: (normalized) => {
      try {
        if (mode === 'edit' && txData?.id) {
          updateTransaction(txData.id, normalized);
          showToast('Transaction updated.');
        } else {
          addTransaction(normalized);
          showToast('Transaction added.');
        }
        closeTransactionModal();
        loadStateFromStorage();
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
 * @param {string} txId
 */
async function handleDeleteTransaction(txId) {
  const target = state.transactions.find((t) => t.id === txId);
  if (!target) return;

  const confirmed = await openConfirmDialog({
    title: 'Delete Transaction',
    message: `Are you sure you want to delete "${target.title}"? This action cannot be undone.`,
    confirmLabel: 'Delete',
  });

  if (!confirmed) return;

  try {
    deleteTransaction(txId);
    loadStateFromStorage();
    renderActiveView();
    showToast('Transaction deleted.');
  } catch (err) {
    showToast(err.message || 'Unable to delete transaction.', 'error');
  }
}

/**
 * Handles opening the edit modal for a specific transaction ID.
 * @param {string} txId
 */
function handleEditRequest(txId) {
  const target = state.transactions.find((t) => t.id === txId);
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
        onCreate: (normalized) => {
          try {
            addTransaction(normalized);
            loadStateFromStorage();
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
          onSaveBudget: (monthKey, limit) => {
            try {
              saveMonthlyBudget(monthKey, limit);
              loadStateFromStorage();
              renderActiveView();
              showToast('Monthly budget updated.');
            } catch (err) {
              showToast(err.message || 'Could not update budget.', 'error');
            }
          },
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
    dom.globalMonthPicker.addEventListener('change', (e) => {
      if (e.target.value) {
        state.activeMonth = e.target.value;
        state.monthlyBudget = getMonthlyBudget(state.activeMonth);
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

      resetSampleData();
      state.activeMonth = getCurrentMonthKey();
      if (dom.globalMonthPicker) dom.globalMonthPicker.value = state.activeMonth;
      loadStateFromStorage();
      renderActiveView();
      showToast('Sample data restored.');
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
function init() {
  ensureInitialized();
  loadStateFromStorage();
  bindGlobalListeners();

  const initialHash = window.location.hash.replace('#', '');
  const initialView = initialHash && dom.views[initialHash] ? initialHash : 'dashboard';
  navigateTo(initialView);
  refreshIcons();
}

init();
