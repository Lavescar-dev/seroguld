'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { apiRequest, buildApiUrl, buildWsUrl } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { labelIdentityDocType, labelMetalType, labelPosStatus, labelPosTradeSide, labelProductType } from '@/lib/labels';
import { sortPosSessionLines } from '@/lib/pos-mappers';
import {
  Customer,
  IdentityDocType,
  MetalType,
  Paginated,
  PosConfirmResponse,
  PosMetalRates,
  PosNumberingPreview,
  PosSessionLine,
  Product,
  PosSession,
  PosTransaction,
  PosTradeSide,
  ProductType,
} from '@/types';
import {
  DEFAULT_INTERNAL_MARGIN_PERCENT,
  identityDocOptions,
  initialConfirm,
  initialCustomer,
  initialQuote,
  metalTypeOptions,
  productTypeOptions,
  wizardSteps,
} from './pos-config';
import {
  ConfirmFormState,
  CustomerMode,
  NewCustomerState,
  PosBulkDraftRow,
  PosBulkLineInput,
  PosDisplayPreviewLineInput,
  PosMixDraftRow,
  PurityPreset,
  QuoteFormState,
  SaleMode,
  WizardStep,
} from './pos-types';
import {
  bulkRowColorClass,
  customerFuzzyScore,
  defaultPuritySeedForMetal,
  digitsOnly,
  findPurityPreset,
  formatDkk,
  inputValue,
  isValidCprInput,
  isValidEmail,
  isValidPhoneInput,
  makeBulkDraftRow,
  makeMixDraftRow,
  metalOptionPrefix,
  metalOptionStyle,
  metalSelectToneClass,
  normalizePurityPercentage,
  parseLooseNumber,
  purityPresetsForMetal,
  toBoundedNumberOrNull,
  toNonNegativeNumberOrNull,
  toNumberOrNull,
  toNumberOrUndefined,
} from './pos-utils';
import { PosQuickStatusAside } from './components/PosQuickStatusAside';
import { PosActiveSessionCard } from './components/PosActiveSessionCard';
import { PosConfirmStepCard } from './components/PosConfirmStepCard';
import { PosCustomerStepCard } from './components/PosCustomerStepCard';
import { PosDocumentFieldsCard } from './components/PosDocumentFieldsCard';
import { PosLinesManagerCard } from './components/PosLinesManagerCard';
import { PosRateStepCard } from './components/PosRateStepCard';
import { PosReceiptStepCard } from './components/PosReceiptStepCard';
import { PosTradeSetupCard } from './components/PosTradeSetupCard';
import { PosWizardHeaderCard } from './components/PosWizardHeaderCard';
import { TradeTypeFocusScreen } from './components/TradeTypeFocusScreen';

function buildIdentityDisplay(typeLabel?: string | null, documentNumber?: string | null): string | null {
  const parts = [typeLabel?.trim(), documentNumber?.trim()].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

export default function AdminPosPage() {
  const uiBuildTag = 'POS-UX-V2-2026-03-17';
  const [wizardStep, setWizardStep] = useState<WizardStep>(0);
  const [tradeSide, setTradeSide] = useState<PosTradeSide>('buy_from_customer');
  const [saleMode, setSaleMode] = useState<SaleMode>('inventory');
  const [customerMode, setCustomerMode] = useState<CustomerMode>('existing');
  const [customerQuery, setCustomerQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [hasFetchedInitialCustomers, setHasFetchedInitialCustomers] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [loadingCustomerSuggestions, setLoadingCustomerSuggestions] = useState(false);
  const [activeCustomerSuggestionIndex, setActiveCustomerSuggestionIndex] = useState(-1);
  const quickSelectRowRef = useRef<HTMLDivElement | null>(null);
  const quickSelectMeasureRef = useRef<HTMLDivElement | null>(null);
  const [quickSelectVisibleCount, setQuickSelectVisibleCount] = useState(8);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [newCustomer, setNewCustomer] = useState<NewCustomerState>(initialCustomer);
  const [sellProducts, setSellProducts] = useState<Product[]>([]);
  const [loadingSellProducts, setLoadingSellProducts] = useState(false);
  const [sellProductQuery, setSellProductQuery] = useState('');
  const [selectedSaleProductId, setSelectedSaleProductId] = useState('');

  const [session, setSession] = useState<PosSession | null>(null);
  const [quote, setQuote] = useState<QuoteFormState>(initialQuote);
  const [manualRate, setManualRate] = useState('');
  const [bulkDraftRows, setBulkDraftRows] = useState<PosBulkDraftRow[]>([]);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkAddMetal, setBulkAddMetal] = useState<MetalType | ''>('');
  const [mixComposerOpen, setMixComposerOpen] = useState(false);
  const [mixProductType, setMixProductType] = useState<ProductType | ''>('');
  const [mixRows, setMixRows] = useState<PosMixDraftRow[]>([]);
  const [showDetailedSteps, setShowDetailedSteps] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [metalBuyRates, setMetalBuyRates] = useState<PosMetalRates | null>(null);
  const [confirmForm, setConfirmForm] = useState<ConfirmFormState>(initialConfirm);
  const [nextReferenceSuggestion, setNextReferenceSuggestion] = useState('');
  const [numberingPreview, setNumberingPreview] = useState<PosNumberingPreview | null>(null);
  const [posTransaction, setPosTransaction] = useState<PosTransaction | null>(null);
  const [loadingPosTransaction, setLoadingPosTransaction] = useState(false);
  const [confirmedProductIds, setConfirmedProductIds] = useState<string[]>([]);
  const [confirmedProductNumbers, setConfirmedProductNumbers] = useState<string[]>([]);
  const [lineTotalAdjustmentApproved, setLineTotalAdjustmentApproved] = useState(false);
  const [saleOverrideApproved, setSaleOverrideApproved] = useState(false);
  const [finalApprovalChecked, setFinalApprovalChecked] = useState(false);
  const [posLines, setPosLines] = useState<PosSessionLine[]>([]);
  const [loadingPosLines, setLoadingPosLines] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string>('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const clerkSocketRef = useRef<WebSocket | null>(null);
  const customerSuggestReqRef = useRef(0);
  const displayWindowRef = useRef<Window | null>(null);
  const displayAutoInitRef = useRef(false);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) || null,
    [customers, selectedCustomerId],
  );
  const quickSelectCandidates = useMemo(() => customers.slice(0, 25), [customers]);
  const selectedSaleProduct = useMemo(
    () => sellProducts.find((product) => product.id === selectedSaleProductId) || null,
    [sellProducts, selectedSaleProductId],
  );
  const selectedLine = useMemo(
    () => posLines.find((line) => line.id === selectedLineId) || null,
    [posLines, selectedLineId],
  );
  const newCustomerName = newCustomer.name.trim();
  const newCustomerPhone = newCustomer.phone.trim();
  const newCustomerCpr = newCustomer.cpr_number.trim();
  const newCustomerPostalCode = newCustomer.postal_code.trim();
  const newCustomerIdentity = newCustomer.identity_doc_number.trim();
  const newCustomerEmail = newCustomer.email.trim();
  const isNewCustomerPhoneValid = !newCustomerPhone || isValidPhoneInput(newCustomerPhone);
  const isNewCustomerCprValid = !newCustomerCpr || isValidCprInput(newCustomerCpr);
  const isNewCustomerIdentityValid = !newCustomerIdentity || newCustomerIdentity.length >= 4;
  const isNewCustomerEmailValid = !newCustomerEmail || isValidEmail(newCustomerEmail);
  const selectedCustomerIdentityDisplay = buildIdentityDisplay(
    selectedCustomer?.identity_doc_type ? labelIdentityDocType(selectedCustomer.identity_doc_type) : null,
    selectedCustomer?.identity_doc_number_masked || null,
  );
  const newCustomerIdentityDisplay = buildIdentityDisplay(
    newCustomer.identity_doc_type ? labelIdentityDocType(newCustomer.identity_doc_type) : null,
    newCustomerIdentity || null,
  );
  const customerSummary = {
    name: customerMode === 'existing' ? selectedCustomer?.name || session?.customer_name || null : newCustomerName || session?.customer_name || null,
    cprDisplay: customerMode === 'existing' ? selectedCustomer?.cpr_number_masked || null : newCustomerCpr || null,
    address: customerMode === 'existing' ? selectedCustomer?.address || null : newCustomer.address.trim() || null,
    postalCode: customerMode === 'existing' ? selectedCustomer?.postal_code || null : newCustomerPostalCode || null,
    phone: customerMode === 'existing' ? selectedCustomer?.phone || null : newCustomerPhone || null,
    email: customerMode === 'existing' ? selectedCustomer?.email || null : newCustomerEmail || null,
    identityDisplay: customerMode === 'existing' ? selectedCustomerIdentityDisplay : newCustomerIdentityDisplay,
  };
  const newCustomerValidationIssues: string[] = [];
  if (!newCustomerName) newCustomerValidationIssues.push('Ad soyad zorunlu.');
  if (!newCustomerPhone) {
    newCustomerValidationIssues.push('Telefon zorunlu.');
  } else if (!isNewCustomerPhoneValid) {
    newCustomerValidationIssues.push('Telefon 7-15 rakam olmalı.');
  }
  if (!newCustomerCpr) {
    newCustomerValidationIssues.push('CPR zorunlu.');
  } else if (!isNewCustomerCprValid) {
    newCustomerValidationIssues.push('CPR 10 rakam olmalı.');
  }
  if (!newCustomerIdentity) {
    newCustomerValidationIssues.push('Kimlik belge numarası zorunlu.');
  } else if (!isNewCustomerIdentityValid) {
    newCustomerValidationIssues.push('Kimlik belge numarası en az 4 karakter olmalı.');
  }
  if (!isNewCustomerEmailValid) {
    newCustomerValidationIssues.push('E-posta formatı geçersiz.');
  }
  const isNewCustomerReady = newCustomerValidationIssues.length === 0;
  const canStartSession = customerMode === 'existing' ? Boolean(selectedCustomerId) : isNewCustomerReady;
  const posLinesTotalOffer = useMemo(
    () =>
      posLines.reduce((total, line) => {
        const offer = toNumberOrNull(line.line_offer_dkk);
        return total + (offer ?? 0);
      }, 0),
    [posLines],
  );
  const supportsMultiline = session?.trade_side === 'buy_from_customer';
  const activeMetalForPurity = quote.metal_type || session?.metal_type || '';
  const purityPresets = useMemo(() => purityPresetsForMetal(activeMetalForPurity), [activeMetalForPurity]);
  const activeRateValue = toNonNegativeNumberOrNull(session?.active_rate_dkk);
  const finalOfferValue = toNonNegativeNumberOrNull(session?.final_offer_dkk);
  const manualSalePriceValue = toNonNegativeNumberOrNull(confirmForm.sale_price_dkk);
  const sessionMarginValue = toNonNegativeNumberOrNull(session?.margin_percent_internal);
  const hasMainQuoteProductFields =
    Boolean(session?.product_type) &&
    Boolean(session?.metal_type) &&
    toNonNegativeNumberOrNull(session?.weight_grams) !== null &&
    toBoundedNumberOrNull(session?.purity_percentage, 0, 100) !== null;
  const hasCoreProductFields = supportsMultiline ? posLines.length > 0 : hasMainQuoteProductFields;
  const hasRateAndOffer = supportsMultiline
    ? posLinesTotalOffer > 0
    : activeRateValue !== null && finalOfferValue !== null && finalOfferValue > 0;
  const hasSellAmount = hasRateAndOffer || (manualSalePriceValue !== null && manualSalePriceValue > 0);
  const hasReadyQuote =
    session?.trade_side === 'sell_to_customer'
      ? hasCoreProductFields && hasSellAmount
      : hasCoreProductFields && hasRateAndOffer;
  const needsSaleProduct = session?.trade_side === 'sell_to_customer' && saleMode === 'inventory';
  const lockQuoteFieldsFromInventory =
    session?.trade_side === 'sell_to_customer' && saleMode === 'inventory' && Boolean(selectedSaleProductId);
  const confirmTargetAmount = useMemo(() => {
    if (!session) return null;
    if (session.trade_side === 'sell_to_customer') {
      return manualSalePriceValue ?? finalOfferValue;
    }
    return finalOfferValue ?? (supportsMultiline && posLinesTotalOffer > 0 ? posLinesTotalOffer : null);
  }, [session, manualSalePriceValue, finalOfferValue, supportsMultiline, posLinesTotalOffer]);
  const posLinesAmountDifference = useMemo(() => {
    if (confirmTargetAmount === null || posLines.length === 0) return null;
    return Number((posLinesTotalOffer - confirmTargetAmount).toFixed(2));
  }, [confirmTargetAmount, posLines.length, posLinesTotalOffer]);
  const hasMeaningfulPosLinesDifference =
    posLinesAmountDifference !== null && Math.abs(posLinesAmountDifference) > 0.01;
  const hasSalePriceOverride =
    session?.trade_side === 'sell_to_customer' &&
    manualSalePriceValue !== null &&
    finalOfferValue !== null &&
    Math.abs(manualSalePriceValue - finalOfferValue) > 0.01;
  const hasSaleMarginOverride =
    session?.trade_side === 'sell_to_customer' &&
    sessionMarginValue !== null &&
    Math.abs(sessionMarginValue - DEFAULT_INTERNAL_MARGIN_PERCENT) > 0.01;
  const requiresSaleOverrideApproval = Boolean(hasSalePriceOverride || hasSaleMarginOverride);
  const hasSaleOverrideReason = confirmForm.sale_override_reason.trim().length >= 6;
  const requiresLineTotalApproval = supportsMultiline && hasMeaningfulPosLinesDifference;
  const canConfirmSession =
    session?.status === 'draft' &&
    hasReadyQuote &&
    (!needsSaleProduct || Boolean(selectedSaleProductId)) &&
    (!requiresLineTotalApproval || lineTotalAdjustmentApproved) &&
    (!requiresSaleOverrideApproval || (saleOverrideApproved && hasSaleOverrideReason)) &&
    finalApprovalChecked;
  const stepCompletion: Record<WizardStep, boolean> = {
    0: true,
    1: Boolean(session),
    2: Boolean(session) && hasCoreProductFields,
    3: Boolean(session) && hasReadyQuote,
    4: session?.status === 'confirmed',
    5: session?.status === 'confirmed',
  };

  function canEnterStep(step: WizardStep): { ok: true } | { ok: false; reason: string } {
    if (step === 0 || step === 1) return { ok: true };
    if (!session) return { ok: false, reason: 'Önce müşteri adımında POS oturumu başlatın.' };
    if (step === 2) return { ok: true };
    if (step === 3) {
      if (!hasCoreProductFields) {
        return {
          ok: false,
          reason: supportsMultiline
            ? 'Önce en az 1 kalemi satır listesine ekleyin.'
            : 'Önce ürün tipi, metal, ağırlık ve saflık alanlarını tamamlayın.',
        };
      }
      return { ok: true };
    }
    if (step === 4) {
      if (!hasReadyQuote) {
        return { ok: false, reason: 'Önce kur ve teklif hesabını tamamlayın.' };
      }
      return { ok: true };
    }
    if (step === 5) {
      if (session.status !== 'confirmed') {
        return { ok: false, reason: 'Önce işlemi onaylayın, sonra belge adımına geçin.' };
      }
      return { ok: true };
    }
    return { ok: true };
  }

  function goToStep(step: WizardStep) {
    const validation = canEnterStep(step);
    if (!validation.ok) {
      setError(validation.reason);
      return;
    }
    setError('');
    setWizardStep(step);
  }

  function goPrevStep() {
    if (wizardStep <= 0) return;
    setError('');
    setWizardStep((wizardStep - 1) as WizardStep);
  }

  function syncStateWithSession(next: PosSession) {
    setSession(next);
    setTradeSide(next.trade_side);
    setQuote({
      product_type: next.product_type || '',
      metal_type: next.metal_type || '',
      weight_grams: inputValue(next.weight_grams),
      purity_karat: next.purity_karat || '',
      purity_percentage: inputValue(next.purity_percentage),
      margin_percent_internal: inputValue(next.margin_percent_internal),
    });
    setManualRate(inputValue(next.manual_rate_dkk));
    if (next.status !== 'confirmed') {
      setPosTransaction(null);
      setConfirmedProductIds([]);
      setConfirmedProductNumbers([]);
      setLineTotalAdjustmentApproved(false);
      setSaleOverrideApproved(false);
    }
    if (next.status !== 'draft') {
      setSelectedLineId('');
      setPosLines([]);
    }
  }

  useEffect(() => {
    if (!session?.id) return;

    const token = getAccessToken();
    if (!token) return;

    const socket = new WebSocket(
      buildWsUrl(`/api/pos/sessions/${session.id}/ws?token=${encodeURIComponent(token)}`),
    );
    clerkSocketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { data?: PosSession };
        if (payload.data) {
          syncStateWithSession(payload.data);
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      if (clerkSocketRef.current === socket) {
        clerkSocketRef.current = null;
      }
      socket.close();
    };
  }, [session?.id]);

  useEffect(() => {
    if (!session || session.status !== 'draft') return;
    const socket = clerkSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const timeout = window.setTimeout(() => {
      const liveRate = toNonNegativeNumberOrNull(session.live_rate_dkk);
      const manualRate = toNonNegativeNumberOrNull(session.manual_rate_dkk);
      const previewLines = supportsMultiline ? buildPreviewLinesForDisplay() : [];
      const payload = {
        trade_side: tradeSide,
        product_type: quote.product_type || null,
        metal_type: quote.metal_type || null,
        weight_grams: toNonNegativeNumberOrNull(quote.weight_grams),
        purity_karat: quote.purity_karat.trim() || null,
        purity_percentage: toBoundedNumberOrNull(quote.purity_percentage, 0, 100),
        margin_percent_internal: toBoundedNumberOrNull(quote.margin_percent_internal, 0, 100),
        rate_source: session.rate_source,
        live_rate_dkk: liveRate,
        manual_rate_dkk: manualRate,
        preview_lines: previewLines.length > 0 ? previewLines : null,
      };

      try {
        socket.send(
          JSON.stringify({
            type: 'clerk:preview',
            data: payload,
          }),
        );
      } catch {
        // socket kapanırsa bir sonraki state değişiminde tekrar denenecek
      }
    }, 25);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    quote.product_type,
    quote.metal_type,
    quote.weight_grams,
    quote.purity_karat,
    quote.purity_percentage,
    quote.margin_percent_internal,
    manualRate,
    posLines,
    bulkDraftRows,
    supportsMultiline,
    session?.id,
    session?.status,
    tradeSide,
    session?.rate_source,
    session?.live_rate_dkk,
    session?.manual_rate_dkk,
  ]);

  async function loadRecentCustomers() {
    setLoadingCustomers(true);
    try {
      const result = await apiRequest<Paginated<Customer>>(
        '/api/customers?page=1&page_size=50&sort_by=recent_activity',
      );
      setCustomers(result.items);
      const selectedStillExists = result.items.some((item) => item.id === selectedCustomerId);
      if ((!selectedCustomerId || !selectedStillExists) && result.items.length > 0) {
        setSelectedCustomerId(result.items[0].id);
      }
      setHasFetchedInitialCustomers(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Müşteri listesi yüklenemedi.');
    } finally {
      setLoadingCustomers(false);
    }
  }

  async function loadMetalBuyRates(options?: { silent?: boolean }) {
    try {
      const rates = await apiRequest<PosMetalRates>('/api/pos/rates/live');
      setMetalBuyRates(rates);
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : 'Metal alış fiyatları alınamadı.');
      }
    }
  }

  useEffect(() => {
    if (customerMode !== 'existing') return;
    if (hasFetchedInitialCustomers) return;
    void loadRecentCustomers();
  }, [customerMode, hasFetchedInitialCustomers]);

  useEffect(() => {
    void loadMetalBuyRates({ silent: true });
  }, []);

  useEffect(() => {
    if (!metalBuyRates) return;
    setBulkDraftRows((prev) =>
      prev.map((row) => {
        if (!row.metal_type) return row;
        const nextDefaultRate = inputValue(metalBuyRates[row.metal_type] || '');
        if (row.default_rate_dkk === nextDefaultRate) return row;
        return {
          ...row,
          default_rate_dkk: nextDefaultRate,
        };
      }),
    );
  }, [metalBuyRates]);

  useEffect(() => {
    if (tradeSide !== 'sell_to_customer') return;
    if (saleMode !== 'inventory') return;
    if (sellProducts.length > 0) return;
    void loadSellProducts();
  }, [tradeSide, saleMode, sellProducts.length]);

  useEffect(() => {
    if (tradeSide === 'sell_to_customer') return;
    setSaleMode('inventory');
    setSelectedSaleProductId('');
    setSellProductQuery('');
    setSaleOverrideApproved(false);
    setConfirmForm((state) => ({
      ...state,
      sale_override_reason: '',
      sale_price_dkk: '',
      manual_purchase_cost_dkk: '',
    }));
  }, [tradeSide]);

  useEffect(() => {
    if (saleMode === 'inventory') return;
    setSelectedSaleProductId('');
  }, [saleMode]);

  useEffect(() => {
    if (!session && wizardStep > 1) {
      setWizardStep(1);
      return;
    }
    if (session?.status === 'confirmed' && wizardStep < 5) {
      setWizardStep(5);
    }
  }, [session, wizardStep]);

  useEffect(() => {
    if (!session || session.status !== 'draft') return;
    if (wizardStep !== 4) return;
    if (session.trade_side === 'sell_to_customer' && saleMode === 'inventory') return;
    if (confirmForm.reference_number.trim()) return;
    void refreshNextReferenceSuggestion(false);
  }, [
    session,
    wizardStep,
    saleMode,
    confirmForm.reference_number,
  ]);

  async function refreshNextReferenceSuggestion(forceApply = false): Promise<void> {
    try {
      const data = await apiRequest<PosNumberingPreview>('/api/pos/numbering/preview');
      setNumberingPreview(data);
      const suggested = String(data.reference_number_next || '').trim();
      setNextReferenceSuggestion(suggested);
      if (suggested && forceApply) {
        setConfirmForm((state) => ({
          ...state,
          reference_number: suggested,
        }));
      }
    } catch {
      try {
        const fallback = await apiRequest<{ reference_number: string }>('/api/pos/reference-next');
        const suggested = String(fallback.reference_number || '').trim();
        setNextReferenceSuggestion(suggested);
        if (suggested && forceApply) {
          setConfirmForm((state) => ({
            ...state,
            reference_number: suggested,
          }));
        }
      } catch {
        // reference preview is supportive UX only; do not block workflow.
      }
    }
  }

  async function loadPosLines(
    sessionId: string,
    options?: {
      silent?: boolean;
    },
  ) {
    setLoadingPosLines(true);
    try {
      const lines = await apiRequest<PosSessionLine[]>(`/api/pos/sessions/${sessionId}/lines`);
      const sortedLines = sortPosSessionLines(lines);
      setPosLines(sortedLines);
      setSelectedLineId((prev) => {
        if (prev && sortedLines.some((line) => line.id === prev)) {
          return prev;
        }
        return sortedLines[0]?.id || '';
      });
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : 'POS kalemleri yüklenemedi.');
      }
      setPosLines([]);
      setSelectedLineId('');
    } finally {
      setLoadingPosLines(false);
    }
  }

  async function refreshSessionSnapshot(
    sessionId: string,
    options?: {
      silent?: boolean;
    },
  ) {
    try {
      const next = await apiRequest<PosSession>(`/api/pos/sessions/${sessionId}`);
      syncStateWithSession(next);
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : 'POS oturumu yenilenemedi.');
      }
    }
  }

  async function loadPosTransaction(sessionId: string) {
    setLoadingPosTransaction(true);
    try {
      const tx = await apiRequest<PosTransaction | null>(`/api/pos/sessions/${sessionId}/transaction`);
      setPosTransaction(tx);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem özeti yüklenemedi.');
      setPosTransaction(null);
    } finally {
      setLoadingPosTransaction(false);
    }
  }

  useEffect(() => {
    if (!session?.id || session.status !== 'confirmed') {
      setPosTransaction(null);
      return;
    }
    void loadPosTransaction(session.id);
  }, [session?.id, session?.status]);

  useEffect(() => {
    if (!session?.id || session.status !== 'draft') {
      setPosLines([]);
      setSelectedLineId('');
      return;
    }
    void loadPosLines(session.id, { silent: true });
  }, [session?.id, session?.status]);

  useEffect(() => {
    setLineTotalAdjustmentApproved(false);
  }, [posLinesAmountDifference]);

  useEffect(() => {
    setSaleOverrideApproved(false);
  }, [session?.id, session?.margin_percent_internal, session?.final_offer_dkk, confirmForm.sale_price_dkk]);

  useEffect(() => {
    setFinalApprovalChecked(false);
  }, [
    session?.id,
    session?.updated_at,
    confirmForm.reference_number,
    confirmForm.storage_location,
    confirmForm.notes,
    confirmForm.needs_cleaning,
    confirmForm.sale_price_dkk,
    confirmForm.manual_purchase_cost_dkk,
    selectedSaleProductId,
    lineTotalAdjustmentApproved,
    saleOverrideApproved,
  ]);

  async function searchCustomers() {
    setError('');
    setMessage('');
    const q = customerQuery.trim();
    if (q.length < 1) {
      await loadRecentCustomers();
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
      setActiveCustomerSuggestionIndex(-1);
      setMessage('Son müşteriler listelendi. Arama için ad, telefon, e-posta veya CPR/kimlik no yazabilirsiniz.');
      return;
    }
    if (q.length < 2) {
      setError('Müşteri araması için en az 2 karakter girin.');
      return;
    }

    setSearching(true);
    try {
      const result = await apiRequest<Customer[]>(`/api/customers/search?q=${encodeURIComponent(q)}`);
      const ranked = [...result].sort((a, b) => customerFuzzyScore(b, q) - customerFuzzyScore(a, q));
      setCustomers(ranked);
      setCustomerSuggestions(ranked.slice(0, 8));
      setShowCustomerSuggestions(ranked.length > 0);
      setActiveCustomerSuggestionIndex(ranked.length > 0 ? 0 : -1);
      const selectedStillExists = ranked.some((item) => item.id === selectedCustomerId);
      if (ranked.length > 0 && (!selectedCustomerId || !selectedStillExists)) {
        setSelectedCustomerId(ranked[0].id);
      }
      if (!ranked.length) {
        setError('Eşleşen müşteri bulunamadı.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Müşteri araması başarısız.');
    } finally {
      setSearching(false);
    }
  }

  function selectSuggestedCustomer(customer: Customer) {
    setSelectedCustomerId(customer.id);
    setCustomerQuery(customer.name);
    setShowCustomerSuggestions(false);
    setActiveCustomerSuggestionIndex(-1);
    setCustomers((prev) => {
      if (prev.some((item) => item.id === customer.id)) return prev;
      return [customer, ...prev];
    });
    setMessage(`Müşteri seçildi: ${customer.name}`);
    setError('');
  }

  function applyPurityPreset(preset: PurityPreset) {
    setQuote((state) => ({
      ...state,
      purity_karat: preset.value,
      purity_percentage: preset.purity,
    }));
  }

  function handlePurityKaratChange(rawValue: string) {
    setQuote((state) => {
      const next = {
        ...state,
        purity_karat: rawValue,
      };
      const matched = findPurityPreset(activeMetalForPurity, rawValue);
      if (matched) {
        next.purity_percentage = matched.purity;
      }
      return next;
    });
  }

  useEffect(() => {
    if (customerMode !== 'existing') return;
    const q = customerQuery.trim();
    if (q.length < 2) {
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
      setLoadingCustomerSuggestions(false);
      setActiveCustomerSuggestionIndex(-1);
      return;
    }

    const requestId = customerSuggestReqRef.current + 1;
    customerSuggestReqRef.current = requestId;
    const timer = window.setTimeout(async () => {
      setLoadingCustomerSuggestions(true);
      try {
        const result = await apiRequest<Customer[]>(`/api/customers/search?q=${encodeURIComponent(q)}`);
        if (requestId !== customerSuggestReqRef.current) return;
        const ranked = [...result].sort((a, b) => customerFuzzyScore(b, q) - customerFuzzyScore(a, q));
        setCustomerSuggestions(ranked.slice(0, 8));
        setShowCustomerSuggestions(ranked.length > 0);
        setActiveCustomerSuggestionIndex(ranked.length > 0 ? 0 : -1);
      } catch {
        if (requestId !== customerSuggestReqRef.current) return;
        setCustomerSuggestions([]);
        setShowCustomerSuggestions(false);
        setActiveCustomerSuggestionIndex(-1);
      } finally {
        if (requestId === customerSuggestReqRef.current) {
          setLoadingCustomerSuggestions(false);
        }
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [customerMode, customerQuery]);

  useEffect(() => {
    if (customerMode === 'existing') return;
    setCustomerSuggestions([]);
    setShowCustomerSuggestions(false);
    setLoadingCustomerSuggestions(false);
    setActiveCustomerSuggestionIndex(-1);
  }, [customerMode]);

  useEffect(() => {
    if (customerMode !== 'existing') return;
    const container = quickSelectRowRef.current;
    const measure = quickSelectMeasureRef.current;
    if (!container || !measure) return;

    const recalc = () => {
      const availableWidth = container.clientWidth;
      if (availableWidth <= 0) {
        setQuickSelectVisibleCount(1);
        return;
      }
      const chipNodes = Array.from(measure.children) as HTMLElement[];
      let used = 0;
      let count = 0;
      const gapPx = 8;
      for (const chip of chipNodes) {
        const width = chip.offsetWidth;
        const next = count === 0 ? width : used + gapPx + width;
        if (next <= availableWidth) {
          used = next;
          count += 1;
        } else {
          break;
        }
      }
      setQuickSelectVisibleCount(Math.max(1, count));
    };

    recalc();
    const observer = new ResizeObserver(() => recalc());
    observer.observe(container);
    window.addEventListener('resize', recalc);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', recalc);
    };
  }, [customerMode, quickSelectCandidates]);

  async function loadSellProducts(query?: string) {
    setLoadingSellProducts(true);
    try {
      const trimmed = (query ?? sellProductQuery).trim();
      const searchPart = trimmed ? `&search=${encodeURIComponent(trimmed)}` : '';
      const result = await apiRequest<Paginated<Product>>(
        `/api/products?page=1&page_size=120&status=for_sale${searchPart}`,
      );
      setSellProducts(result.items);
      if (selectedSaleProductId && !result.items.some((item) => item.id === selectedSaleProductId)) {
        setSelectedSaleProductId('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Satış ürünleri yüklenemedi.');
    } finally {
      setLoadingSellProducts(false);
    }
  }

  function applySelectedSaleProductToQuote() {
    if (!selectedSaleProduct) {
      setError('Önce satış için bir ürün seçin.');
      return;
    }
    setError('');
    setQuote((state) => ({
      ...state,
      product_type: selectedSaleProduct.product_type,
      metal_type: selectedSaleProduct.metal_type,
      weight_grams: inputValue(selectedSaleProduct.weight_grams),
      purity_karat: selectedSaleProduct.purity_karat || state.purity_karat || '',
      purity_percentage: inputValue(selectedSaleProduct.purity_percentage),
    }));
    setConfirmForm((state) => ({
      ...state,
      reference_number: state.reference_number || selectedSaleProduct.reference_number || '',
      sale_price_dkk: state.sale_price_dkk || inputValue(selectedSaleProduct.sale_price_dkk),
    }));
    setMessage(
      `Satış ürünü #${selectedSaleProduct.product_number} teklif alanına aktarıldı. Kur ve teklifi güncelleyip onaylayabilirsiniz.`,
    );
  }

  async function createSession(): Promise<boolean> {
    setError('');
    setMessage('');

    const payload: Record<string, unknown> = { trade_side: tradeSide };
    let forceNewSession = false;

    if (customerMode === 'existing') {
      if (!selectedCustomerId) {
        setError('Önce mevcut bir müşteri seçin.');
        return false;
      }
      payload.customer_id = selectedCustomerId;
    } else {
      if (newCustomerValidationIssues.length > 0) {
        setError(newCustomerValidationIssues[0]);
        return false;
      }
      const name = newCustomerName;
      const phone = newCustomerPhone;
      const cpr = digitsOnly(newCustomerCpr);
      const identityNumber = newCustomerIdentity;
      const email = newCustomerEmail;
      const addressRaw = newCustomer.address.trim();
      const postalCodeRaw = newCustomerPostalCode;
      const composedAddress = [addressRaw, postalCodeRaw ? `Postnr: ${postalCodeRaw}` : ''].filter(Boolean).join(' | ');
      payload.customer_new = {
        name,
        phone,
        email: email || null,
        address: composedAddress || null,
        cpr_number: cpr,
        identity_doc_type: newCustomer.identity_doc_type || null,
        identity_doc_number: identityNumber,
        identity_doc_country: newCustomer.identity_doc_country.trim() || 'DK',
        identity_photo_refs: [],
      };
    }

    async function activateSessionFromServer(
      nextSession: PosSession,
      mode: 'created' | 'resumed',
    ): Promise<void> {
      syncStateWithSession(nextSession);
      if (nextSession.status === 'confirmed') {
        setWizardStep(5);
      } else {
        setWizardStep(2);
      }
      setSelectedSaleProductId('');
      setConfirmForm(initialConfirm);
      setNextReferenceSuggestion('');
      setNumberingPreview(null);
      setPosTransaction(null);
      setConfirmedProductIds([]);
      setConfirmedProductNumbers([]);
      setLineTotalAdjustmentApproved(false);
      setSaleOverrideApproved(false);
      resetBulkRows(0);
      setMixComposerOpen(false);
      setMixRows([]);
      setMixProductType('');
      if (nextSession.status === 'draft') {
        await loadPosLines(nextSession.id, { silent: true });
      } else {
        setPosLines([]);
        setSelectedLineId('');
      }
      if (nextSession.trade_side === 'sell_to_customer' && saleMode === 'inventory') {
        await loadSellProducts();
      }
      if (
        nextSession.status === 'draft' &&
        !(nextSession.trade_side === 'sell_to_customer' && saleMode === 'inventory')
      ) {
        await refreshNextReferenceSuggestion(false);
      }
      const displayWindowOpened = openOrReuseDisplay(`/display/${nextSession.display_token}?kiosk=1`);
      if (mode === 'resumed') {
        if (displayWindowOpened) {
          setMessage(`Açık taslak oturuma devam edildi: ${nextSession.session_code}. Müşteri ekranı açıldı.`);
        } else {
          setMessage(
            `Açık taslak oturuma devam edildi: ${nextSession.session_code}. Müşteri ekranını "Müşteri Ekranı (Aktif)" ile açın.`,
          );
        }
        return;
      }

      const modeNote =
        nextSession.trade_side === 'sell_to_customer'
          ? ` Satış yöntemi: ${saleMode === 'inventory' ? 'envanterden' : 'manuel'}.`
          : '';
      if (displayWindowOpened) {
        setMessage(`POS oturumu açıldı: ${nextSession.session_code}.${modeNote} Müşteri ekranı açıldı.`);
      } else {
        setMessage(
          `POS oturumu açıldı: ${nextSession.session_code}.${modeNote} Müşteri ekranını "Müşteri Ekranını Aç" ile manuel açın.`,
        );
      }
    }

    setBusy(true);
    try {
      if (customerMode === 'existing' && selectedCustomerId) {
        const openDraft = await apiRequest<PosSession | null>(
          `/api/pos/sessions/open-draft?customer_id=${encodeURIComponent(selectedCustomerId)}&trade_side=${encodeURIComponent(tradeSide)}`,
        );
        if (openDraft) {
          const continueExisting = window.confirm(
            `Bu müşteri için açık taslak POS oturumu bulundu: ${openDraft.session_code}.\n\nTamam: Bu taslağa devam et\nİptal: Yeni bir taslak oturum aç`,
          );
          if (continueExisting) {
            await activateSessionFromServer(openDraft, 'resumed');
            return true;
          }
          forceNewSession = true;
        }
      }

      if (forceNewSession) {
        payload.force_new_session = true;
      }

      const created = await apiRequest<PosSession>('/api/pos/sessions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await activateSessionFromServer(created, 'created');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'POS oturumu açılamadı.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function buildQuotePayload(requireAtLeastOneField: boolean): Record<string, unknown> | null {
    const payload: Record<string, unknown> = {};
    if (quote.product_type) payload.product_type = quote.product_type;
    if (quote.metal_type) payload.metal_type = quote.metal_type;

    const weight = toNumberOrUndefined(quote.weight_grams);
    const purity = toNumberOrUndefined(quote.purity_percentage);
    const margin = toNumberOrUndefined(quote.margin_percent_internal);

    if (weight !== undefined && weight <= 0) {
      setError('Ağırlık 0\'dan büyük olmalıdır.');
      return null;
    }
    if (purity !== undefined && (purity < 0 || purity > 100)) {
      setError('Saflık değeri 0 ile 100 arasında olmalıdır.');
      return null;
    }
    if (margin !== undefined && (margin < 0 || margin > 100)) {
      setError('Marj değeri 0 ile 100 arasında olmalıdır.');
      return null;
    }

    if (weight !== undefined) payload.weight_grams = weight;
    if (quote.purity_karat.trim()) payload.purity_karat = quote.purity_karat.trim();
    if (purity !== undefined) payload.purity_percentage = purity;
    if (margin !== undefined) payload.margin_percent_internal = margin;

    if (requireAtLeastOneField && !Object.keys(payload).length) {
      setError('Teklif güncellemesi için en az bir alan girin.');
      return null;
    }

    return payload;
  }

  async function persistQuoteDraftIfAny(): Promise<boolean> {
    if (!session) {
      setError('Önce POS oturumu açın.');
      return false;
    }

    const payload = buildQuotePayload(false);
    if (payload === null) return false;
    if (!Object.keys(payload).length) return true;
    try {
      const updated = await apiRequest<PosSession>(`/api/pos/sessions/${session.id}/quote`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      syncStateWithSession(updated);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teklif alanları kaydedilemedi.');
      return false;
    }
  }

  async function saveQuote(): Promise<boolean> {
    if (!session) {
      setError('Önce POS oturumu açın.');
      return false;
    }

    setError('');
    setMessage('');

    const payload = buildQuotePayload(true);
    if (payload === null) return false;

    setBusy(true);
    try {
      const updated = await apiRequest<PosSession>(`/api/pos/sessions/${session.id}/quote`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      syncStateWithSession(updated);
      setMessage('Teklif alanları güncellendi.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teklif güncellenemedi.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function buildLinePayloadFromQuote(): Record<string, unknown> | null {
    if (!quote.product_type) {
      setError('Kalem eklemek için ürün tipi seçin.');
      return null;
    }
    if (!quote.metal_type) {
      setError('Kalem eklemek için metal tipi seçin.');
      return null;
    }

    const weight = toNumberOrUndefined(quote.weight_grams);
    if (weight === undefined || weight <= 0) {
      setError('Kalem eklemek için geçerli ağırlık girin.');
      return null;
    }

    const purity = toNumberOrUndefined(quote.purity_percentage);
    if (purity === undefined || purity < 0 || purity > 100) {
      setError('Kalem eklemek için saflık değeri 0-100 arasında olmalı.');
      return null;
    }

    const payload: Record<string, unknown> = {
      product_type: quote.product_type,
      metal_type: quote.metal_type,
      weight_grams: weight,
      purity_percentage: purity,
    };

    const purityKarat = quote.purity_karat.trim();
    if (purityKarat) payload.purity_karat = purityKarat;

    const margin = toNumberOrUndefined(quote.margin_percent_internal);
    if (margin !== undefined && margin >= 0 && margin <= 100) {
      payload.margin_percent_internal = margin;
    }

    const manualRateNumber = toNumberOrUndefined(manualRate);
    const activeRateNumber = toNonNegativeNumberOrNull(session?.active_rate_dkk);
    const rate = manualRateNumber && manualRateNumber > 0 ? manualRateNumber : activeRateNumber;
    if (rate !== null && rate !== undefined && rate > 0) {
      payload.rate_dkk = rate;
    }

    return payload;
  }

  function applyLineToQuote(line: PosSessionLine) {
    setError('');
    setSelectedLineId(line.id);
    setQuote((state) => ({
      ...state,
      product_type: line.product_type,
      metal_type: line.metal_type,
      weight_grams: inputValue(line.weight_grams),
      purity_karat: line.purity_karat || '',
      purity_percentage: inputValue(line.purity_percentage),
      margin_percent_internal: inputValue(line.margin_percent_internal),
    }));
    if (line.rate_dkk) {
      setManualRate(inputValue(line.rate_dkk));
    }
    setMessage(`Kalem #${line.line_no} teklif alanına aktarıldı.`);
  }

  async function addCurrentQuoteAsLine() {
    if (!session || session.status !== 'draft') {
      setError('Kalem eklemek için aktif taslak POS oturumu gerekir.');
      return;
    }
    setError('');
    setMessage('');
    const payload = buildLinePayloadFromQuote();
    if (!payload) return;

    setBusy(true);
    try {
      const line = await apiRequest<PosSessionLine>(`/api/pos/sessions/${session.id}/lines`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setPosLines((prev) => sortPosSessionLines([...prev, line]));
      setSelectedLineId(line.id);
      await refreshSessionSnapshot(session.id, { silent: true });
      setMessage(`Kalem eklendi (#${line.line_no}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kalem eklenemedi.');
    } finally {
      setBusy(false);
    }
  }

  function createBulkRowSeed(metalOverride?: MetalType | ''): Partial<Omit<PosBulkDraftRow, 'id'>> {
    const seedMetal = metalOverride || quote.metal_type || session?.metal_type || '';
    const puritySeed = defaultPuritySeedForMetal(seedMetal);
    const keepQuotePurity =
      Boolean(quote.purity_karat || quote.purity_percentage) &&
      (!metalOverride || metalOverride === quote.metal_type);
    return {
      product_type: quote.product_type || '',
      metal_type: seedMetal,
      purity_karat: keepQuotePurity ? quote.purity_karat || puritySeed.karat : puritySeed.karat,
      purity_percentage: keepQuotePurity ? quote.purity_percentage || puritySeed.purity : puritySeed.purity,
      default_rate_dkk: seedMetal ? inputValue(metalBuyRates?.[seedMetal] || '') : '',
      rate_dkk: '',
      margin_percent_internal:
        quote.margin_percent_internal ||
        inputValue(session?.margin_percent_internal) ||
        String(DEFAULT_INTERNAL_MARGIN_PERCENT),
    };
  }

  function appendBulkRowsForMetal(metal: MetalType | ''): number {
    const safeMetal = metal || quote.metal_type || session?.metal_type || '';
    if (!safeMetal) {
      setError('Önce metal seçin.');
      return 0;
    }
    let added = 0;
    setBulkDraftRows((prev) => {
      const remaining = Math.max(0, 50 - prev.length);
      if (remaining <= 0) {
        setError('Toplu satır limiti 50. Yeni satır eklemek için önce bazılarını silin.');
        return prev;
      }
      const safeCount = 1;
      added = safeCount;
      const seed = createBulkRowSeed(safeMetal);
      return [...prev, ...Array.from({ length: safeCount }, () => makeBulkDraftRow(seed))];
    });
    return added;
  }

  function resetBulkRows(count = 0) {
    const safeCount = Math.max(0, Math.min(50, count));
    if (safeCount === 0) {
      setBulkDraftRows([]);
      return;
    }
    const seed = createBulkRowSeed();
    setBulkDraftRows(Array.from({ length: safeCount }, () => makeBulkDraftRow(seed)));
  }

  function patchBulkRow(rowId: string, patch: Partial<Omit<PosBulkDraftRow, 'id'>>) {
    setBulkDraftRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function patchBulkRowMetal(rowId: string, metal: MetalType | '') {
    const puritySeed = defaultPuritySeedForMetal(metal);
    const defaultRate = metal ? inputValue(metalBuyRates?.[metal] || '') : '';
    setBulkDraftRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        return {
          ...row,
          metal_type: metal,
          purity_karat: puritySeed.karat,
          purity_percentage: puritySeed.purity,
          default_rate_dkk: defaultRate,
        };
      }),
    );
  }

  function patchBulkRowKarat(rowId: string, purityKarat: string) {
    setBulkDraftRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const matched = findPurityPreset(row.metal_type, purityKarat);
        return {
          ...row,
          purity_karat: purityKarat,
          purity_percentage: matched ? matched.purity : row.purity_percentage,
        };
      }),
    );
  }

  function removeBulkRow(rowId: string) {
    setBulkDraftRows((prev) => prev.filter((row) => row.id !== rowId));
  }

  function openMixComposer() {
    setError('');
    setMessage('');
    setMixComposerOpen(true);
    setMixProductType((prev) => prev || quote.product_type || '');
    setMixRows((prev) => {
      if (prev.length > 0) return prev;
      const seedMetal = (quote.metal_type || session?.metal_type || '') as MetalType | '';
      return [makeMixDraftRow({ metal_type: seedMetal })];
    });
  }

  function addMixRow(seedMetal?: MetalType | '') {
    setMixRows((prev) => {
      if (prev.length >= 50) {
        setError('Karışım satır limiti 50.');
        return prev;
      }
      return [...prev, makeMixDraftRow({ metal_type: seedMetal || '' })];
    });
  }

  function patchMixRow(rowId: string, patch: Partial<Omit<PosMixDraftRow, 'id'>>) {
    setMixRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function patchMixRowMetal(rowId: string, metal: MetalType | '') {
    const puritySeed = defaultPuritySeedForMetal(metal);
    setMixRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        return {
          ...row,
          metal_type: metal,
          purity_karat: puritySeed.karat,
          purity_percentage: puritySeed.purity,
        };
      }),
    );
  }

  function patchMixRowKarat(rowId: string, purityKarat: string) {
    setMixRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const matched = findPurityPreset(row.metal_type, purityKarat);
        return {
          ...row,
          purity_karat: purityKarat,
          purity_percentage: matched ? matched.purity : row.purity_percentage,
        };
      }),
    );
  }

  function removeMixRow(rowId: string) {
    setMixRows((prev) => prev.filter((row) => row.id !== rowId));
  }

  function applyMixRowsToBulkDraft() {
    setError('');
    setMessage('');

    const productType = mixProductType || quote.product_type;
    if (!productType) {
      setError('Karışım için önce ürün tipi seçin.');
      return;
    }

    const isBlankMixRow = (row: PosMixDraftRow) =>
      !row.metal_type &&
      !row.weight_grams.trim() &&
      !row.purity_karat.trim() &&
      !row.purity_percentage.trim() &&
      !row.notes.trim();

    const activeRows = mixRows.filter((row) => !isBlankMixRow(row));
    if (!activeRows.length) {
      setError('Karışımda en az bir dolu satır olmalı.');
      return;
    }

    const errors: string[] = [];
    const seeds: Array<Partial<Omit<PosBulkDraftRow, 'id'>>> = [];
    const fallbackMargin =
      quote.margin_percent_internal ||
      inputValue(session?.margin_percent_internal) ||
      String(DEFAULT_INTERNAL_MARGIN_PERCENT);

    activeRows.forEach((row, index) => {
      const lineNo = index + 1;
      if (!row.metal_type) {
        errors.push(`Karışım satır ${lineNo}: metal seçin.`);
        return;
      }
      const weight = parseLooseNumber(row.weight_grams);
      if (weight === null || weight <= 0) {
        errors.push(`Karışım satır ${lineNo}: gram alanı geçersiz.`);
        return;
      }

      const matched = findPurityPreset(row.metal_type, row.purity_karat);
      const purity =
        normalizePurityPercentage(row.purity_percentage) ??
        (matched ? normalizePurityPercentage(matched.purity) : null);
      if (purity === null) {
        errors.push(`Karışım satır ${lineNo}: ayar/saflık geçersiz.`);
        return;
      }

      let purityKarat = row.purity_karat.trim() || matched?.value || '';
      if (purityKarat.length > 10) purityKarat = purityKarat.slice(0, 10);

      seeds.push({
        product_type: productType,
        metal_type: row.metal_type,
        weight_grams: inputValue(Number(weight.toFixed(2))),
        purity_karat: purityKarat,
        purity_percentage: inputValue(Number(purity.toFixed(2))),
        default_rate_dkk: inputValue(metalBuyRates?.[row.metal_type] || ''),
        rate_dkk: '',
        margin_percent_internal: fallbackMargin,
        notes: row.notes.trim(),
      });
    });

    if (errors.length > 0) {
      setError(errors.slice(0, 3).join(' '));
      return;
    }

    const remaining = Math.max(0, 50 - bulkDraftRows.length);
    if (remaining <= 0) {
      setError('Toplu satır limiti 50. Önce bazı satırları temizleyin.');
      return;
    }
    const accepted = seeds.slice(0, remaining);
    setBulkDraftRows((prev) => [...prev, ...accepted.map((seed) => makeBulkDraftRow(seed))]);
    setMixComposerOpen(false);
    setMixRows([]);
    setMixProductType('');
    setMessage(
      accepted.length < seeds.length
        ? `Karışımdan ${accepted.length} satır eklendi (limit nedeniyle bazı satırlar atlandı).`
        : `Karışımdan ${accepted.length} satır hazırlandı.`,
    );
  }

  function startBulkAddFlow() {
    setError('');
    setMessage('');
    setBulkAddMetal((quote.metal_type || session?.metal_type || '') as MetalType | '');
    setBulkAddOpen(true);
  }

  function confirmBulkAddFlow() {
    if (!bulkAddMetal) {
      setError('Önce metal seçin.');
      return;
    }
    const added = appendBulkRowsForMetal(bulkAddMetal);
    if (!added) return;
    setBulkAddOpen(false);
    setMessage(`${labelMetalType(bulkAddMetal)} için ${added} satır açıldı.`);
  }

  function isBulkRowBlank(row: PosBulkDraftRow): boolean {
    return (
      !row.product_type &&
      !row.weight_grams.trim() &&
      !row.rate_dkk.trim() &&
      !row.notes.trim()
    );
  }

  function buildBulkLineItemsFromRows(): {
    items: PosBulkLineInput[];
    skipped: number;
    errors: string[];
  } {
    const parsed: PosBulkLineInput[] = [];
    const errors: string[] = [];
    let skipped = 0;

    const fallbackProductType = quote.product_type || '';
    const fallbackMetal = quote.metal_type || session?.metal_type || '';
    const fallbackRate =
      toNonNegativeNumberOrNull(manualRate) ?? toNonNegativeNumberOrNull(session?.active_rate_dkk);
    const fallbackMargin =
      toBoundedNumberOrNull(quote.margin_percent_internal, 0, 100) ??
      toBoundedNumberOrNull(session?.margin_percent_internal, 0, 100) ??
      DEFAULT_INTERNAL_MARGIN_PERCENT;

    bulkDraftRows.forEach((row, rowIndex) => {
      const lineNo = rowIndex + 1;
      if (isBulkRowBlank(row)) {
        skipped += 1;
        return;
      }

      const productType = row.product_type || fallbackProductType;
      if (!productType) {
        errors.push(`Satır ${lineNo}: ürün tipi seçilmedi.`);
        return;
      }

      const metalType = row.metal_type || fallbackMetal;
      if (!metalType) {
        errors.push(`Satır ${lineNo}: metal tipi seçilmedi.`);
        return;
      }

      const weight = parseLooseNumber(row.weight_grams);
      if (weight === null || weight <= 0) {
        errors.push(`Satır ${lineNo}: ağırlık geçersiz.`);
        return;
      }

      const karatRaw = row.purity_karat.trim() || quote.purity_karat.trim();
      const matchedPreset = findPurityPreset(metalType, karatRaw);
      let purityPercentage = normalizePurityPercentage(row.purity_percentage);
      if (purityPercentage === null) {
        purityPercentage =
          normalizePurityPercentage(karatRaw) ??
          (matchedPreset ? normalizePurityPercentage(matchedPreset.purity) : null) ??
          normalizePurityPercentage(quote.purity_percentage);
      }
      if (purityPercentage === null) {
        errors.push(`Satır ${lineNo}: saflık/karat geçersiz.`);
        return;
      }

      let purityKarat = (karatRaw || matchedPreset?.value || '').trim();
      if (purityKarat.length > 10) purityKarat = purityKarat.slice(0, 10);

      const parsedRate = parseLooseNumber(row.rate_dkk);
      const rowDefaultRate = parseLooseNumber(row.default_rate_dkk);
      const rate = parsedRate !== null ? parsedRate : rowDefaultRate ?? fallbackRate;
      if (rate !== null && rate <= 0) {
        errors.push(`Satır ${lineNo}: kur 0'dan büyük olmalı.`);
        return;
      }

      const parsedMargin = parseLooseNumber(row.margin_percent_internal);
      const margin = parsedMargin !== null ? parsedMargin : fallbackMargin;
      if (margin < 0 || margin > 100) {
        errors.push(`Satır ${lineNo}: marj 0-100 aralığında olmalı.`);
        return;
      }

      const item: PosBulkLineInput = {
        product_type: productType,
        metal_type: metalType,
        weight_grams: Number(weight.toFixed(2)),
        purity_percentage: Number(purityPercentage.toFixed(2)),
        margin_percent_internal: Number(margin.toFixed(2)),
      };
      if (purityKarat) item.purity_karat = purityKarat;
      if (rate !== null) item.rate_dkk = Number(rate.toFixed(2));
      if (row.notes.trim()) item.notes = row.notes.trim();

      parsed.push(item);
    });

    if (parsed.length > 50) {
      errors.push(`Tek seferde en fazla 50 kalem eklenebilir. Mevcut satır: ${parsed.length}`);
    }

    return { items: parsed, skipped, errors };
  }

  function buildPreviewLinesForDisplay(): PosDisplayPreviewLineInput[] {
    const preview: PosDisplayPreviewLineInput[] = [];

    const fallbackProductType = quote.product_type || '';
    const fallbackMetal = quote.metal_type || session?.metal_type || '';
    const fallbackRate =
      toNonNegativeNumberOrNull(manualRate) ??
      toNonNegativeNumberOrNull(session?.active_rate_dkk) ??
      toNonNegativeNumberOrNull(session?.live_rate_dkk);
    const fallbackMargin =
      toBoundedNumberOrNull(quote.margin_percent_internal, 0, 100) ??
      toBoundedNumberOrNull(session?.margin_percent_internal, 0, 100) ??
      DEFAULT_INTERNAL_MARGIN_PERCENT;

    posLines.forEach((line) => {
      const weight = toNonNegativeNumberOrNull(line.weight_grams);
      const purity = toBoundedNumberOrNull(line.purity_percentage, 0, 100);
      if (weight === null || weight <= 0 || purity === null) return;
      preview.push({
        product_type: line.product_type,
        metal_type: line.metal_type,
        weight_grams: Number(weight.toFixed(2)),
        purity_karat: line.purity_karat || undefined,
        purity_percentage: Number(purity.toFixed(2)),
        rate_dkk: toNonNegativeNumberOrNull(line.rate_dkk) ?? undefined,
        margin_percent_internal: toBoundedNumberOrNull(line.margin_percent_internal, 0, 100) ?? undefined,
        line_offer_dkk: toNonNegativeNumberOrNull(line.line_offer_dkk) ?? undefined,
        notes: line.notes?.trim() || undefined,
      });
    });

    bulkDraftRows.forEach((row) => {
      if (isBulkRowBlank(row)) return;
      const productType = (row.product_type || fallbackProductType) as ProductType | '';
      const metalType = (row.metal_type || fallbackMetal) as MetalType | '';
      if (!productType || !metalType) return;
      const weight = parseLooseNumber(row.weight_grams);
      if (weight === null || weight <= 0) return;

      const karatRaw = row.purity_karat.trim() || quote.purity_karat.trim();
      const matchedPreset = findPurityPreset(metalType, karatRaw);
      const purity =
        normalizePurityPercentage(row.purity_percentage) ??
        normalizePurityPercentage(karatRaw) ??
        (matchedPreset ? normalizePurityPercentage(matchedPreset.purity) : null) ??
        normalizePurityPercentage(quote.purity_percentage);
      if (purity === null) return;

      const parsedRate = parseLooseNumber(row.rate_dkk);
      const rowDefaultRate = parseLooseNumber(row.default_rate_dkk);
      const rate = parsedRate !== null ? parsedRate : rowDefaultRate ?? fallbackRate;
      if (rate !== null && rate <= 0) return;

      const parsedMargin = parseLooseNumber(row.margin_percent_internal);
      const margin = parsedMargin !== null ? parsedMargin : fallbackMargin;
      if (margin < 0 || margin > 100) return;

      const purityKarat = (karatRaw || matchedPreset?.value || '').trim();
      preview.push({
        product_type: productType,
        metal_type: metalType,
        weight_grams: Number(weight.toFixed(2)),
        purity_karat: purityKarat || undefined,
        purity_percentage: Number(purity.toFixed(2)),
        rate_dkk: rate !== null ? Number(rate.toFixed(2)) : undefined,
        margin_percent_internal: Number(margin.toFixed(2)),
        notes: row.notes.trim() || undefined,
      });
    });

    return preview.slice(0, 50);
  }

  async function addBulkRowsAsLines() {
    if (!session || session.status !== 'draft') {
      setError('Toplu kalem eklemek için aktif taslak POS oturumu gerekir.');
      return;
    }
    if (!supportsMultiline) {
      setError('Toplu kalem ekleme sadece alış akışında kullanılabilir.');
      return;
    }
    setError('');
    setMessage('');

    const parsed = buildBulkLineItemsFromRows();
    if (parsed.errors.length > 0) {
      const preview = parsed.errors.slice(0, 5).join(' ');
      const suffix = parsed.errors.length > 5 ? ` (+${parsed.errors.length - 5} hata daha)` : '';
      setError(`Toplu giriş doğrulaması başarısız. ${preview}${suffix}`);
      return;
    }
    if (!parsed.items.length) {
      setError('Geçerli kalem bulunamadı.');
      return;
    }

    setBusy(true);
    try {
      const createdLines = await apiRequest<PosSessionLine[]>(`/api/pos/sessions/${session.id}/lines/bulk`, {
        method: 'POST',
        body: JSON.stringify({ items: parsed.items }),
      });
      const sortedLines = sortPosSessionLines([...posLines, ...createdLines]);
      setPosLines(sortedLines);
      const primaryLine = createdLines[0];
      await refreshSessionSnapshot(session.id, { silent: true });
      setSelectedLineId((prev) => prev || primaryLine?.id || '');
      resetBulkRows(0);
      setMessage(
        `${createdLines.length} kalem eklendi.${parsed.skipped ? ` ${parsed.skipped} boş satır atlandı.` : ''}`.trim(),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toplu kalem ekleme başarısız.');
    } finally {
      setBusy(false);
    }
  }

  async function updateSelectedLineFromQuote() {
    if (!session || session.status !== 'draft') {
      setError('Kalem güncellemek için aktif taslak POS oturumu gerekir.');
      return;
    }
    if (!selectedLineId) {
      setError('Önce güncellenecek bir kalem seçin.');
      return;
    }

    setError('');
    setMessage('');
    const payload = buildLinePayloadFromQuote();
    if (!payload) return;

    setBusy(true);
    try {
      const updatedLine = await apiRequest<PosSessionLine>(
        `/api/pos/sessions/${session.id}/lines/${selectedLineId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      );
      setPosLines((prev) => sortPosSessionLines(prev.map((line) => (line.id === updatedLine.id ? updatedLine : line))));
      await refreshSessionSnapshot(session.id, { silent: true });
      setMessage(`Kalem #${updatedLine.line_no} güncellendi.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kalem güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedLine() {
    if (!session || session.status !== 'draft') {
      setError('Kalem silmek için aktif taslak POS oturumu gerekir.');
      return;
    }
    if (!selectedLineId) {
      setError('Önce silinecek bir kalem seçin.');
      return;
    }

    const confirmed = window.confirm('Seçili kalemi silmek istediğinize emin misiniz?');
    if (!confirmed) return;

    setError('');
    setMessage('');
    setBusy(true);
    try {
      await apiRequest<void>(`/api/pos/sessions/${session.id}/lines/${selectedLineId}`, {
        method: 'DELETE',
      });
      await loadPosLines(session.id, { silent: true });
      await refreshSessionSnapshot(session.id, { silent: true });
      setMessage('Seçili kalem silindi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kalem silinemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function syncRate() {
    if (!session) {
      setError('Önce POS oturumu açın.');
      return;
    }
    if (!(quote.metal_type || session.metal_type)) {
      setError('Canlı kur çekmek için önce metal tipi seçin.');
      return;
    }

    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (!(await persistQuoteDraftIfAny())) return false;
      const updated = await apiRequest<PosSession>(`/api/pos/sessions/${session.id}/rate/sync`, {
        method: 'POST',
      });
      syncStateWithSession(updated);
      setMessage('Canlı kur senkronize edildi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Canlı kur senkronizasyonu başarısız.');
    } finally {
      setBusy(false);
    }
  }

  async function applyManualRate() {
    if (!session) {
      setError('Önce POS oturumu açın.');
      return;
    }

    const manualRateNumber = toNumberOrUndefined(manualRate);
    if (manualRateNumber === undefined || manualRateNumber <= 0) {
      setError('Geçerli bir manuel kur girin.');
      return;
    }

    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (!(await persistQuoteDraftIfAny())) return false;
      const updated = await apiRequest<PosSession>(`/api/pos/sessions/${session.id}/rate/manual`, {
        method: 'PATCH',
        body: JSON.stringify({ manual_rate_dkk: manualRateNumber }),
      });
      syncStateWithSession(updated);
      setMessage('Manuel kur uygulandı.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Manuel kur uygulanamadı.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSession(): Promise<boolean> {
    if (!session) {
      setError('Önce POS oturumu açın.');
      return false;
    }
    if (requiresLineTotalApproval && !lineTotalAdjustmentApproved) {
      setError('Kalem toplamı farkı için onay kutusunu işaretleyin.');
      return false;
    }
    if (requiresSaleOverrideApproval && !saleOverrideApproved) {
      setError('Satış fiyat/marj override onayı olmadan işleme devam edemezsiniz.');
      return false;
    }
    if (requiresSaleOverrideApproval && !hasSaleOverrideReason) {
      setError('Satış override işlemi için en az 6 karakterlik denetim notu girin.');
      return false;
    }
    if (!finalApprovalChecked) {
      setError('İşlem onayı için "son kontrol" kutusunu işaretleyin.');
      return false;
    }
    if (!canConfirmSession) {
      setError('Onay için zorunlu alanları tamamlayın. Satışta envanter veya manuel yönteme göre alanlar değişir.');
      return false;
    }

    const previewAmount = formatDkk(confirmTargetAmount);
    const previewLines = posLines.length > 0 ? `${posLines.length} kalem` : 'tek kalem';
    const reviewPrompt = [
      `Müşteri: ${session.customer_name || '-'}`,
      `İşlem: ${labelPosTradeSide(session.trade_side)}`,
      `Kalem: ${previewLines}`,
      `Toplam Tutar: ${previewAmount} DKK`,
      `Referans: ${confirmForm.reference_number.trim() || nextReferenceSuggestion || '-'}`,
      `Depolama: ${confirmForm.storage_location.trim() || '-'}`,
    ].join('\n');
    const userConfirmed = window.confirm(`Bu işlemi onaylamak üzeresiniz:\n\n${reviewPrompt}\n\nDevam edilsin mi?`);
    if (!userConfirmed) {
      setMessage('İşlem onayı iptal edildi.');
      return false;
    }

    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (!(await persistQuoteDraftIfAny())) return false;

      const salePrice = toNumberOrUndefined(confirmForm.sale_price_dkk);
      const manualPurchaseCost = toNumberOrUndefined(confirmForm.manual_purchase_cost_dkk);
      const result = await apiRequest<PosConfirmResponse>(`/api/pos/sessions/${session.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          reference_number: confirmForm.reference_number.trim() || null,
          storage_location: confirmForm.storage_location.trim() || null,
          notes: confirmForm.notes.trim() || null,
          needs_cleaning: confirmForm.needs_cleaning,
          allow_line_total_adjustment: requiresLineTotalApproval && lineTotalAdjustmentApproved,
          sale_override_approved: requiresSaleOverrideApproval && saleOverrideApproved,
          sale_override_reason: requiresSaleOverrideApproval ? confirmForm.sale_override_reason.trim() || null : null,
          sale_product_id:
            session.trade_side === 'sell_to_customer' && saleMode === 'inventory'
              ? selectedSaleProductId || null
              : null,
          sale_price_dkk: salePrice && salePrice > 0 ? salePrice : null,
          manual_purchase_cost_dkk:
            session.trade_side === 'sell_to_customer' && saleMode === 'manual' && manualPurchaseCost && manualPurchaseCost > 0
              ? manualPurchaseCost
              : null,
        }),
      });
      syncStateWithSession(result.session);
      setConfirmedProductIds(
        result.product_ids?.length ? result.product_ids : (result.product_id ? [result.product_id] : []),
      );
      setConfirmedProductNumbers(
        result.product_numbers?.length ? result.product_numbers : (result.product_number ? [result.product_number] : []),
      );
      setWizardStep(5);
      const createdCount = result.product_numbers?.length || (result.product_number ? 1 : 0);
      const firstNumber = result.product_number;
      const firstId = result.product_id;
      setMessage(
        session.trade_side === 'sell_to_customer'
          ? `Satış onaylandı (${saleMode === 'inventory' ? 'envanterden' : 'manuel'}). Ürün no: ${firstNumber} (detay: /admin/products/${firstId})`
          : createdCount > 1
            ? `İşlem onaylandı. ${createdCount} ürün oluşturuldu. İlk ürün no: ${firstNumber} (detay: /admin/products/${firstId})`
            : `İşlem onaylandı. Oluşan ürün no: ${firstNumber} (detay: /admin/products/${firstId})`,
      );
      openDisplay('standby');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'POS işlemi onaylanamadı.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession() {
    if (!session) {
      setError('Önce POS oturumu açın.');
      return;
    }

    const confirmed = window.confirm('Bu POS oturumunu iptal etmek istediğinize emin misiniz?');
    if (!confirmed) return;

    setError('');
    setMessage('');
    setBusy(true);
    try {
      const cancelled = await apiRequest<PosSession>(`/api/pos/sessions/${session.id}/cancel`, {
        method: 'POST',
      });
      syncStateWithSession(cancelled);
      setWizardStep(1);
      setMessage('POS oturumu iptal edildi.');
      openDisplay('standby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'POS oturumu iptal edilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function openReceiptHtml(audience: 'customer' | 'admin') {
    if (!session || session.status !== 'confirmed') {
      setError('Belge önizlemesi için önce POS işlemini onaylayın.');
      return;
    }

    setError('');
    setMessage('');
    setBusy(true);
    try {
      const payload = await apiRequest<Blob>(
        `/api/pos/sessions/${session.id}/receipt?audience=${audience}&format=html`,
      );
      const html = await payload.text();
      const popup = window.open('', '_blank');
      if (!popup) {
        setError('Tarayıcı pop-up engelledi. Lütfen pop-up izni verip tekrar deneyin.');
        return;
      }
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      setMessage(`${audience === 'customer' ? 'Müşteri' : 'Yönetim'} belge önizlemesi açıldı.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Belge önizlemesi açılamadı.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadReceiptPdf(audience: 'customer' | 'admin') {
    if (!session || session.status !== 'confirmed') {
      setError('PDF belge için önce POS işlemini onaylayın.');
      return;
    }

    setError('');
    setMessage('');
    setBusy(true);
    try {
      const payload = await apiRequest<Blob>(
        `/api/pos/sessions/${session.id}/receipt?audience=${audience}&format=pdf`,
      );
      const downloadUrl = URL.createObjectURL(payload);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `seroguld-belge-${session.session_code}-${audience}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setMessage(`${audience === 'customer' ? 'Müşteri' : 'Yönetim'} PDF belgesi indirildi.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF belge indirilemedi.');
    } finally {
      setBusy(false);
    }
  }

  function openDisplay(mode: 'active' | 'standby' = 'active') {
    const url =
      mode === 'standby' || !session?.display_token
        ? '/display/idle?kiosk=1'
        : `/display/${session.display_token}?kiosk=1`;
    const opened = openOrReuseDisplay(url);
    if (!opened) {
      setError('Müşteri ekranı açılamadı. Pencere engeli veya sistem kısıtı olabilir.');
    }
  }

  const canEditSession = session?.status === 'draft';
  const confirmBlockers: string[] = [];
  if (session && session.status === 'draft') {
    if (session.trade_side === 'sell_to_customer' && saleMode === 'inventory' && !selectedSaleProductId) {
      confirmBlockers.push('Satış (envanter) modu için bir ürün seçilmedi.');
    }
    if (supportsMultiline) {
      if (posLines.length === 0) {
        confirmBlockers.push('En az 1 kalem eklenmedi.');
      }
      if (posLinesTotalOffer <= 0) {
        confirmBlockers.push('Kalem toplamı geçersiz.');
      }
    } else {
      if (!session.product_type) confirmBlockers.push('Ürün tipi seçilmedi.');
      if (!session.metal_type) confirmBlockers.push('Metal tipi seçilmedi.');
      if (toNonNegativeNumberOrNull(session.weight_grams) === null) confirmBlockers.push('Ağırlık girilmedi.');
      if (toBoundedNumberOrNull(session.purity_percentage, 0, 100) === null)
        confirmBlockers.push('Saflık yüzdesi eksik veya geçersiz.');
    }
    if (session.trade_side === 'sell_to_customer') {
      if ((finalOfferValue === null || finalOfferValue <= 0) && (manualSalePriceValue === null || manualSalePriceValue <= 0)) {
        confirmBlockers.push('Satış fiyatı girin veya kur/tekliften otomatik fiyat oluşturun.');
      }
    } else {
      if (!supportsMultiline) {
        if (activeRateValue === null) confirmBlockers.push('Aktif kur henüz belirlenmedi.');
      }
      if (confirmTargetAmount === null || confirmTargetAmount <= 0) {
        confirmBlockers.push('Nihai teklif henüz hesaplanmadı.');
      }
    }
    if (requiresLineTotalApproval && !lineTotalAdjustmentApproved) {
      confirmBlockers.push('Kalem toplamı farkı için açık onay verilmedi.');
    }
    if (requiresSaleOverrideApproval && !saleOverrideApproved) {
      confirmBlockers.push('Satış fiyat/marj override için açık onay verilmedi.');
    }
    if (requiresSaleOverrideApproval && !hasSaleOverrideReason) {
      confirmBlockers.push('Satış override denetim notu eksik (min 6 karakter).');
    }
    if (!finalApprovalChecked) {
      confirmBlockers.push('Son kontrol onayı işaretlenmedi.');
    }
  }
  const flowAwareWizardSteps = useMemo(() => {
    if (tradeSide === 'sell_to_customer') {
      return [
        { id: 0 as WizardStep, title: 'Satış', hint: saleMode === 'inventory' ? 'Envanterden veya manuel satış türü' : 'Manuel satış türü ve onay' },
        { id: 1 as WizardStep, title: 'Müşteri', hint: 'Alıcı müşteri seç ve satış oturumu başlat' },
        { id: 2 as WizardStep, title: 'Ürün', hint: saleMode === 'inventory' ? 'Stoktan ürün seç, teklif alanına aktar' : 'Ürün detaylarını elle doldur' },
        { id: 3 as WizardStep, title: 'Fiyat', hint: 'Satış fiyatını netleştir, kuru doğrula' },
        { id: 4 as WizardStep, title: 'Onay', hint: 'Override varsa açık onay + not zorunlu' },
        { id: 5 as WizardStep, title: 'Belge', hint: 'Fatura ve satış özeti çıktısı' },
      ];
    }
    return wizardSteps;
  }, [tradeSide, saleMode]);
  const currentStepMeta = flowAwareWizardSteps[wizardStep];
  const totalWizardSteps = flowAwareWizardSteps.length;
  const flowLabel =
    tradeSide === 'sell_to_customer'
      ? `Canlı Satış${saleMode === 'inventory' ? ' (Envanter)' : ' (Manuel)'}`
      : 'Canlı Alış';
  const stepPrimaryActionLabel =
    wizardStep === 0
      ? 'Müşteri Adımına Geç'
      : wizardStep === 1
        ? session
          ? 'Teklif Adımına Geç'
          : 'POS Oturumu Başlat'
        : wizardStep === 2
          ? supportsMultiline
            ? hasCoreProductFields
              ? 'Kur Adımına Geç'
              : 'Önce Kalem Ekle'
            : 'Teklifi Kaydet ve Kur Adımına Geç'
          : wizardStep === 3
            ? hasReadyQuote
              ? 'Onay Adımına Geç'
              : 'Önce Teklifi Tamamla'
            : wizardStep === 4
              ? session?.trade_side === 'sell_to_customer'
                ? saleMode === 'inventory'
                  ? 'Satışı Onayla'
                  : 'Manuel Satışı Onayla'
                : 'İşlemi Onayla'
              : 'Müşteri Belgesini Aç';
  const phaseGroups: Array<{
    key: 'A' | 'B' | 'C';
    title: string;
    hint: string;
    steps: WizardStep[];
  }> = [
    { key: 'A', title: 'Faz A', hint: 'İşlem + Müşteri', steps: [0, 1] },
    { key: 'B', title: 'Faz B', hint: 'Kalem + Kur', steps: [2, 3] },
    { key: 'C', title: 'Faz C', hint: 'Onay + Belge', steps: [4, 5] },
  ];
  const phaseCards: Array<{
    key: 'A' | 'B' | 'C';
    title: string;
    hint: string;
    steps: WizardStep[];
    completed: boolean;
    active: boolean;
    entryStep: WizardStep;
    locked: boolean;
  }> = phaseGroups.map((group) => {
    const completed = group.steps.every((step) => stepCompletion[step]);
    const active = group.steps.includes(wizardStep);
    const entryStep = group.steps[0];
    const entryValidation = canEnterStep(entryStep);
    return {
      ...group,
      completed,
      active,
      entryStep,
      locked: !entryValidation.ok && !active,
    };
  });

  function openOrReuseDisplay(url: string): boolean {
    try {
      const existing = displayWindowRef.current;
      if (existing && !existing.closed) {
        try {
          existing.location.replace(url);
          existing.focus();
          return true;
        } catch {
          // eski pencere handle'i geçersizse yeniden açılacak
        }
      }

      const opened = window.open(
        url,
        'seroguld-customer-display',
        'width=1920,height=1080,left=1920,top=0',
      );
      if (!opened) {
        return false;
      }
      displayWindowRef.current = opened;
      try {
        opened.focus();
      } catch {
        // no-op
      }
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (displayAutoInitRef.current) return;
    displayAutoInitRef.current = true;
    window.setTimeout(() => {
      openOrReuseDisplay('/display/idle?kiosk=1');
    }, 180);
  }, []);

  async function runPrimaryStepAction() {
    if (busy) return;
    if (wizardStep === 0) {
      goToStep(1);
      return;
    }
    if (wizardStep === 1) {
      if (session) {
        goToStep(2);
        return;
      }
      await createSession();
      return;
    }
    if (wizardStep === 2) {
      if (!session) {
        setError('Önce POS oturumu başlatın.');
        return;
      }
      if (supportsMultiline) {
        if (!hasCoreProductFields) {
          setError('Önce en az 1 kalemi satır listesine ekleyin.');
          return;
        }
        setWizardStep(3);
        return;
      }
      const saved = await saveQuote();
      if (saved) {
        setWizardStep(3);
      }
      return;
    }
    if (wizardStep === 3) {
      if (hasReadyQuote) {
        goToStep(4);
        return;
      }
      setError('Kur ve teklif tamamlanmadan onay adımına geçemezsiniz.');
      return;
    }
    if (wizardStep === 4) {
      await confirmSession();
      return;
    }
    if (wizardStep === 5 && session?.status === 'confirmed') {
      await openReceiptHtml('customer');
    }
  }

  function chooseTradeSide(side: PosTradeSide) {
    if (busy || session) return;
    setError('');
    setMessage('');
    setTradeSide(side);
    if (side === 'buy_from_customer') {
      setSaleMode('inventory');
    }
    setWizardStep(1);
  }

  const isTradeTypeFocusScreen = wizardStep === 0 && !session;
  const isCustomerSelectionFocusScreen =
    wizardStep === 1 && !session && tradeSide === 'buy_from_customer';
  const isBuyLinesFocusScreen =
    wizardStep === 2 && tradeSide === 'buy_from_customer' && Boolean(session);
  const hidePosChrome =
    isTradeTypeFocusScreen || isCustomerSelectionFocusScreen || isBuyLinesFocusScreen;
  const customerFocusFieldClass = isCustomerSelectionFocusScreen ? 'h-14 text-lg md:h-16 md:text-xl' : '';

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter') return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      if (tag === 'textarea' || target.isContentEditable) return;
      event.preventDefault();
      void runPrimaryStepAction();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, wizardStep, session, hasReadyQuote, saleMode]);

  return (
    <div className={hidePosChrome ? 'grid gap-4' : 'grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]'}>
      <div className="space-y-4">
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          Aktif UI Yapisi: {uiBuildTag}
        </div>
        {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
        {message && <p className="text-sm font-semibold text-emerald-700">{message}</p>}

        {isTradeTypeFocusScreen ? (
          <TradeTypeFocusScreen
            onChooseBuy={() => chooseTradeSide('buy_from_customer')}
            onChooseSell={() => chooseTradeSide('sell_to_customer')}
          />
        ) : !isCustomerSelectionFocusScreen && !isBuyLinesFocusScreen ? (
          <PosWizardHeaderCard
            flowLabel={flowLabel}
            wizardStep={wizardStep}
            totalWizardSteps={totalWizardSteps}
            currentStepTitle={currentStepMeta.title}
            currentStepHint={currentStepMeta.hint}
            busy={busy}
            phaseCards={phaseCards}
            flowAwareWizardSteps={flowAwareWizardSteps}
            stepCompletion={stepCompletion}
            showDetailedSteps={showDetailedSteps}
            showAdvancedTools={showAdvancedTools}
            onOpenDisplay={() => openDisplay('standby')}
            onGoPrevStep={goPrevStep}
            onGoToStep={goToStep}
            onToggleDetailedSteps={() => setShowDetailedSteps((prev) => !prev)}
            onToggleAdvancedTools={() => setShowAdvancedTools((prev) => !prev)}
            canEnterStep={canEnterStep}
            onPrimaryAction={() => void runPrimaryStepAction()}
            stepPrimaryActionLabel={stepPrimaryActionLabel}
          />
        ) : null}

      {wizardStep === 0 && !isTradeTypeFocusScreen && (
        <PosTradeSetupCard
          tradeSide={tradeSide}
          saleMode={saleMode}
          sessionExists={Boolean(session)}
          onSetTradeSide={setTradeSide}
          onSetSaleMode={setSaleMode}
        />
      )}

      {wizardStep === 1 && (
        <PosCustomerStepCard
          isCustomerSelectionFocusScreen={isCustomerSelectionFocusScreen}
          tradeSide={tradeSide}
          sessionExists={Boolean(session)}
          saleMode={saleMode}
          customerMode={customerMode}
          customerFocusFieldClass={customerFocusFieldClass}
          customerQuery={customerQuery}
          customerSuggestions={customerSuggestions}
          showCustomerSuggestions={showCustomerSuggestions}
          loadingCustomerSuggestions={loadingCustomerSuggestions}
          activeCustomerSuggestionIndex={activeCustomerSuggestionIndex}
          selectedCustomerId={selectedCustomerId}
          selectedCustomer={selectedCustomer}
          quickSelectCandidates={quickSelectCandidates}
          quickSelectVisibleCount={quickSelectVisibleCount}
          quickSelectRowRef={quickSelectRowRef}
          quickSelectMeasureRef={quickSelectMeasureRef}
          loadingCustomers={loadingCustomers}
          searching={searching}
          newCustomer={newCustomer}
          isNewCustomerPhoneValid={isNewCustomerPhoneValid}
          isNewCustomerCprValid={isNewCustomerCprValid}
          isNewCustomerIdentityValid={isNewCustomerIdentityValid}
          isNewCustomerEmailValid={isNewCustomerEmailValid}
          newCustomerName={newCustomerName}
          newCustomerPhone={newCustomerPhone}
          newCustomerCpr={newCustomerCpr}
          newCustomerPostalCode={newCustomerPostalCode}
          newCustomerIdentity={newCustomerIdentity}
          newCustomerValidationIssues={newCustomerValidationIssues}
          isNewCustomerReady={isNewCustomerReady}
          canStartSession={canStartSession}
          busy={busy}
          identityDocOptions={identityDocOptions}
          onSetSaleMode={setSaleMode}
          onSetCustomerMode={setCustomerMode}
          onSetCustomerQuery={setCustomerQuery}
          onSetShowCustomerSuggestions={setShowCustomerSuggestions}
          onSetActiveCustomerSuggestionIndex={setActiveCustomerSuggestionIndex}
          onSelectSuggestedCustomer={selectSuggestedCustomer}
          onSearchCustomers={searchCustomers}
          onLoadRecentCustomers={loadRecentCustomers}
          onClearSelectedCustomer={() => {
            setSelectedCustomerId('');
            setCustomerQuery('');
            setShowCustomerSuggestions(false);
          }}
          onSetNewCustomer={setNewCustomer}
          onCreateSession={createSession}
        />
      )}

      {session && wizardStep >= 2 && (
        <PosActiveSessionCard
          isBuyLinesFocusScreen={isBuyLinesFocusScreen}
          sessionCode={session.session_code}
          sessionStatusLabel={labelPosStatus(session.status)}
          tradeSideLabel={labelPosTradeSide(session.trade_side)}
          saleModeLabel={session.trade_side === 'sell_to_customer' ? (saleMode === 'inventory' ? 'Envanterden' : 'Manuel') : null}
          customerName={session.customer_name}
          displayToken={session.display_token}
          showAdvancedTools={showAdvancedTools}
          onOpenDisplayActive={() => openDisplay('active')}
          onOpenDisplayStandby={() => openDisplay('standby')}
        />
      )}

      <div className={`grid gap-4 xl:grid-cols-1 ${wizardStep === 2 || wizardStep === 3 ? '' : 'hidden'}`}>
        <div className={`${isBuyLinesFocusScreen ? 'card mx-auto w-full max-w-[1400px] p-6 md:p-8' : 'card p-4'} ${wizardStep === 2 ? '' : 'hidden'}`}>
          <h3 className={isBuyLinesFocusScreen ? 'text-xl font-semibold text-brand-900 md:text-2xl' : 'text-base font-semibold text-brand-900'}>
            {supportsMultiline ? '3) Afregningsbilag Kalemleri' : '3) Teklif Alanları'}
          </h3>
          <p className={isBuyLinesFocusScreen ? 'mt-2 text-base text-brand-700 md:text-lg' : 'mt-1 text-sm text-brand-700'}>
            {supportsMultiline
              ? 'Excel kolon düzeni: Type | Karat / % Finhed | Lødighed | Vægt i g | Enhedspris / g | I alt'
              : tradeSide === 'sell_to_customer'
                ? saleMode === 'inventory'
                  ? 'Envanterden satışta ürün bilgileri stoktan gelir.'
                  : 'Manuel satışta ürün bilgilerini buradan girin.'
                : 'Ürün, gram ve saflık bilgilerini girin.'}
          </p>
          <PosDocumentFieldsCard
            tradeSide={session?.trade_side}
            sessionCode={session?.session_code}
            lineCount={posLines.length}
            numberingPreview={numberingPreview}
            customerSummary={customerSummary}
          />
          {!supportsMultiline && <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Select
              value={quote.product_type}
              onChange={(event) =>
                setQuote((state) => ({
                  ...state,
                  product_type: event.target.value as ProductType | '',
                }))
              }
              disabled={!canEditSession || lockQuoteFieldsFromInventory}
            >
              <option value="">Ürün tipi seçin</option>
              {productTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              value={quote.metal_type}
              onChange={(event) =>
                setQuote((state) => ({
                  ...state,
                  metal_type: event.target.value as MetalType | '',
                }))
              }
              className={metalSelectToneClass(quote.metal_type)}
              disabled={!canEditSession || lockQuoteFieldsFromInventory}
            >
              <option value="">Metal tipi seçin</option>
              {metalTypeOptions.map((option) => (
                <option key={option.value} value={option.value} style={metalOptionStyle(option.value)}>
                  {metalOptionPrefix(option.value)} {option.label}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Ağırlık (gram)"
              value={quote.weight_grams}
              onChange={(event) =>
                setQuote((state) => ({
                  ...state,
                  weight_grams: event.target.value,
                }))
              }
              disabled={!canEditSession || lockQuoteFieldsFromInventory}
            />
            <Input
              list="purity-karat-presets"
              placeholder={activeMetalForPurity === 'silver' ? 'Finelik (örn: 925)' : 'Ayar/finelik (örn: 18K, 750)'}
              value={quote.purity_karat}
              onChange={(event) => handlePurityKaratChange(event.target.value)}
              disabled={!canEditSession || lockQuoteFieldsFromInventory}
            />
            <datalist id="purity-karat-presets">
              {purityPresets.map((preset) => (
                <option key={`${preset.value}-${preset.purity}`} value={preset.value}>
                  {preset.value} ({preset.purity}%)
                </option>
              ))}
            </datalist>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="Saflık (%)"
              value={quote.purity_percentage}
              onChange={(event) =>
                setQuote((state) => ({
                  ...state,
                  purity_percentage: event.target.value,
                }))
              }
              disabled={!canEditSession || lockQuoteFieldsFromInventory}
            />
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="Satıcı marjı (%) - müşteri görmez"
              value={quote.margin_percent_internal}
              onChange={(event) =>
                setQuote((state) => ({
                  ...state,
                  margin_percent_internal: event.target.value,
                }))
              }
              disabled={!canEditSession}
            />
          </div>}
          {!supportsMultiline && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-700">
            <span className="font-semibold text-brand-800">Hızlı saflık presetleri:</span>
            {purityPresets.map((preset) => (
              <button
                key={`chip-${preset.value}-${preset.purity}`}
                type="button"
                onClick={() => applyPurityPreset(preset)}
                disabled={!canEditSession || lockQuoteFieldsFromInventory}
                className="rounded-full border border-brand-300 px-2 py-1 text-[11px] text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {preset.value} ({preset.purity}%)
              </button>
            ))}
          </div>}
          {!supportsMultiline && <p className="mt-1 text-xs text-brand-600">
            Preset seçince saflık (%) otomatik dolar; isterseniz elle değiştirebilirsiniz.
          </p>}

          <PosLinesManagerCard
            supportsMultiline={supportsMultiline}
            canEditSession={canEditSession}
            busy={busy}
            startBulkAddFlow={startBulkAddFlow}
            addBulkRowsAsLines={addBulkRowsAsLines}
            bulkDraftRows={bulkDraftRows}
            loadMetalBuyRates={loadMetalBuyRates}
            setShowAdvancedTools={setShowAdvancedTools}
            showAdvancedTools={showAdvancedTools}
            resetBulkRows={resetBulkRows}
            session={session}
            loadPosLines={loadPosLines}
            loadingPosLines={loadingPosLines}
            addCurrentQuoteAsLine={addCurrentQuoteAsLine}
            bulkAddOpen={bulkAddOpen}
            metalTypeOptions={metalTypeOptions}
            bulkAddMetal={bulkAddMetal}
            setBulkAddMetal={setBulkAddMetal}
            metalBuyRates={metalBuyRates}
            setBulkAddOpen={setBulkAddOpen}
            confirmBulkAddFlow={confirmBulkAddFlow}
            mixComposerOpen={mixComposerOpen}
            openMixComposer={openMixComposer}
            setMixComposerOpen={setMixComposerOpen}
            mixProductType={mixProductType}
            setMixProductType={setMixProductType}
            productTypeOptions={productTypeOptions}
            addMixRow={addMixRow}
            applyMixRowsToBulkDraft={applyMixRowsToBulkDraft}
            mixRows={mixRows}
            patchMixRowMetal={patchMixRowMetal}
            quote={quote}
            patchMixRowKarat={patchMixRowKarat}
            patchMixRow={patchMixRow}
            removeMixRow={removeMixRow}
            patchBulkRow={patchBulkRow}
            patchBulkRowMetal={patchBulkRowMetal}
            patchBulkRowKarat={patchBulkRowKarat}
            removeBulkRow={removeBulkRow}
            posLines={posLines}
            selectedLineId={selectedLineId}
            setSelectedLineId={setSelectedLineId}
            selectedLine={selectedLine}
            posLinesTotalOffer={posLinesTotalOffer}
            deleteSelectedLine={deleteSelectedLine}
            applyLineToQuote={applyLineToQuote}
            updateSelectedLineFromQuote={updateSelectedLineFromQuote}
          />

          {session?.trade_side === 'sell_to_customer' && saleMode === 'inventory' && (
            <div className="mt-4 space-y-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
              <p className="text-sm font-semibold text-brand-900">Satış İçin Envanter Ürünü</p>
              <p className="text-xs text-brand-700">
                Satış modunda önce stoktan bir ürün seçin, sonra ürün bilgilerini teklif alanına aktarın.
              </p>
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <Input
                  value={sellProductQuery}
                  onChange={(event) => setSellProductQuery(event.target.value)}
                  placeholder="Ürün no, referans veya satıcı adı ile ara"
                  disabled={!canEditSession}
                />
                <Button variant="ghost" onClick={() => void loadSellProducts()} disabled={loadingSellProducts || !canEditSession}>
                  {loadingSellProducts ? 'Yükleniyor...' : 'Satış Ürünlerini Getir'}
                </Button>
              </div>
              <Select
                value={selectedSaleProductId}
                onChange={(event) => setSelectedSaleProductId(event.target.value)}
                disabled={!canEditSession}
              >
                <option value="">Satılacak ürünü seçin</option>
                {sellProducts.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.product_number} · {labelProductType(item.product_type)} · {item.weight_grams}g ·{' '}
                    {item.purity_karat || '-'} · {labelMetalType(item.metal_type)}
                  </option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={applySelectedSaleProductToQuote} disabled={!canEditSession || !selectedSaleProductId}>
                  Ürün Bilgilerini Teklife Aktar
                </Button>
                {selectedSaleProduct && (
                  <Link
                    href={`/admin/products/${selectedSaleProduct.id}`}
                    target="_blank"
                    className="inline-flex items-center rounded-lg border border-brand-300 px-3 py-2 text-sm text-brand-800 hover:bg-brand-100"
                  >
                    Ürün Detayını Aç
                  </Link>
                )}
              </div>
            </div>
          )}

          {session?.trade_side === 'sell_to_customer' && saleMode === 'manual' && (
            <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">
              <p className="font-semibold text-brand-900">Manuel Satış Notu</p>
              <p className="mt-1">
                Bu modda ürün stoktan seçilmeden elle girilir. Onay sonrası satış kaydı oluşturulur ve ürün satıldı
                durumuna alınır.
              </p>
            </div>
          )}

          {!supportsMultiline && (
            <div className="mt-4">
              <Button onClick={saveQuote} disabled={!canEditSession || busy}>
                Teklifi Güncelle
              </Button>
            </div>
          )}
        </div>

        <PosRateStepCard
          visible={wizardStep === 3}
          session={session}
          saleMode={saleMode}
          canEditSession={canEditSession}
          busy={busy}
          manualRate={manualRate}
          setManualRate={setManualRate}
          onSyncRate={() => void syncRate()}
          onApplyManualRate={() => void applyManualRate()}
        />
      </div>

      <PosConfirmStepCard
        visible={wizardStep === 4}
        session={session}
        saleMode={saleMode}
        canEditSession={canEditSession}
        busy={busy}
        confirmForm={confirmForm}
        setConfirmForm={setConfirmForm}
        confirmTargetAmount={confirmTargetAmount}
        formatDkk={formatDkk}
        requiresSaleOverrideApproval={requiresSaleOverrideApproval}
        hasSalePriceOverride={hasSalePriceOverride}
        hasSaleMarginOverride={hasSaleMarginOverride}
        finalOfferValue={finalOfferValue}
        manualSalePriceValue={manualSalePriceValue}
        sessionMarginValue={sessionMarginValue}
        saleOverrideApproved={saleOverrideApproved}
        setSaleOverrideApproved={setSaleOverrideApproved}
        posLines={posLines}
        posLinesTotalOffer={posLinesTotalOffer}
        hasMeaningfulPosLinesDifference={hasMeaningfulPosLinesDifference}
        posLinesAmountDifference={posLinesAmountDifference}
        lineTotalAdjustmentApproved={lineTotalAdjustmentApproved}
        setLineTotalAdjustmentApproved={setLineTotalAdjustmentApproved}
        nextReferenceSuggestion={nextReferenceSuggestion}
        numberingPreview={numberingPreview}
        customerSummary={customerSummary}
        finalApprovalChecked={finalApprovalChecked}
        setFinalApprovalChecked={setFinalApprovalChecked}
        canConfirmSession={canConfirmSession}
        confirmBlockers={confirmBlockers}
        onRefreshNextReferenceSuggestion={() => void refreshNextReferenceSuggestion(true)}
        onConfirmSession={confirmSession}
        onCancelSession={cancelSession}
      />

      <PosReceiptStepCard
        visible={Boolean(session?.status === 'confirmed' && wizardStep === 5)}
        session={session}
        busy={busy}
        receiptApiUrl={session ? buildApiUrl(`/api/pos/sessions/${session.id}/receipt`) : '-'}
        confirmedProductIds={confirmedProductIds}
        confirmedProductNumbers={confirmedProductNumbers}
        loadingPosTransaction={loadingPosTransaction}
        posTransaction={posTransaction}
        onOpenReceiptHtml={(copyType) => void openReceiptHtml(copyType)}
        onDownloadReceiptPdf={(copyType) => void downloadReceiptPdf(copyType)}
      />

      </div>

      {!hidePosChrome && (
        <PosQuickStatusAside
          flowLabel={flowLabel}
          wizardStep={wizardStep}
          totalWizardSteps={totalWizardSteps}
          sessionCode={session?.session_code}
          customerName={session?.customer_name}
          statusLabel={session ? labelPosStatus(session.status) : '-'}
          finalAmountLabel={`${formatDkk(confirmTargetAmount)} DKK`}
          activeRateLabel={`${formatDkk(activeRateValue)} DKK/g`}
          confirmBlockersCount={confirmBlockers.length}
          hasSession={Boolean(session)}
          canGoToConfirm={hasReadyQuote}
          onOpenDisplay={() => openDisplay('active')}
          onGoToConfirm={() => goToStep(4)}
        />
      )}
    </div>
  );
}
