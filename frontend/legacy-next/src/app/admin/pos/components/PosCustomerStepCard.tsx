'use client';

import type { Dispatch, Ref, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { labelIdentityDocType } from '@/lib/labels';
import type { Customer, IdentityDocType, PosTradeSide } from '@/types';
import type { NewCustomerState, CustomerMode, SaleMode } from '../pos-types';

type IdentityDocOption = {
  value: IdentityDocType;
  label: string;
};

type PosCustomerStepCardProps = {
  isCustomerSelectionFocusScreen: boolean;
  tradeSide: PosTradeSide;
  sessionExists: boolean;
  saleMode: SaleMode;
  customerMode: CustomerMode;
  customerFocusFieldClass: string;
  customerQuery: string;
  customerSuggestions: Customer[];
  showCustomerSuggestions: boolean;
  loadingCustomerSuggestions: boolean;
  activeCustomerSuggestionIndex: number;
  selectedCustomerId: string;
  selectedCustomer: Customer | null;
  quickSelectCandidates: Customer[];
  quickSelectVisibleCount: number;
  quickSelectRowRef: Ref<HTMLDivElement>;
  quickSelectMeasureRef: Ref<HTMLDivElement>;
  loadingCustomers: boolean;
  searching: boolean;
  newCustomer: NewCustomerState;
  isNewCustomerPhoneValid: boolean;
  isNewCustomerCprValid: boolean;
  isNewCustomerIdentityValid: boolean;
  isNewCustomerEmailValid: boolean;
  newCustomerName: string;
  newCustomerPhone: string;
  newCustomerCpr: string;
  newCustomerPostalCode: string;
  newCustomerIdentity: string;
  newCustomerValidationIssues: string[];
  isNewCustomerReady: boolean;
  canStartSession: boolean;
  busy: boolean;
  identityDocOptions: IdentityDocOption[];
  onSetSaleMode: (mode: SaleMode) => void;
  onSetCustomerMode: (mode: CustomerMode) => void;
  onSetCustomerQuery: (value: string) => void;
  onSetShowCustomerSuggestions: (value: boolean) => void;
  onSetActiveCustomerSuggestionIndex: Dispatch<SetStateAction<number>>;
  onSelectSuggestedCustomer: (customer: Customer) => void;
  onSearchCustomers: () => Promise<void>;
  onLoadRecentCustomers: () => Promise<void>;
  onClearSelectedCustomer: () => void;
  onSetNewCustomer: Dispatch<SetStateAction<NewCustomerState>>;
  onCreateSession: () => Promise<boolean>;
};

export function PosCustomerStepCard({
  isCustomerSelectionFocusScreen,
  tradeSide,
  sessionExists,
  saleMode,
  customerMode,
  customerFocusFieldClass,
  customerQuery,
  customerSuggestions,
  showCustomerSuggestions,
  loadingCustomerSuggestions,
  activeCustomerSuggestionIndex,
  selectedCustomerId,
  selectedCustomer,
  quickSelectCandidates,
  quickSelectVisibleCount,
  quickSelectRowRef,
  quickSelectMeasureRef,
  loadingCustomers,
  searching,
  newCustomer,
  isNewCustomerPhoneValid,
  isNewCustomerCprValid,
  isNewCustomerIdentityValid,
  isNewCustomerEmailValid,
  newCustomerName,
  newCustomerPhone,
  newCustomerCpr,
  newCustomerPostalCode,
  newCustomerIdentity,
  newCustomerValidationIssues,
  isNewCustomerReady,
  canStartSession,
  busy,
  identityDocOptions,
  onSetSaleMode,
  onSetCustomerMode,
  onSetCustomerQuery,
  onSetShowCustomerSuggestions,
  onSetActiveCustomerSuggestionIndex,
  onSelectSuggestedCustomer,
  onSearchCustomers,
  onLoadRecentCustomers,
  onClearSelectedCustomer,
  onSetNewCustomer,
  onCreateSession,
}: PosCustomerStepCardProps) {
  return (
    <div className={isCustomerSelectionFocusScreen ? 'card mx-auto w-full max-w-6xl p-8 md:p-10' : 'card p-4'}>
      <h3 className={isCustomerSelectionFocusScreen ? 'text-3xl font-bold text-brand-900 md:text-5xl' : 'text-base font-semibold text-brand-900'}>
        Müşteri Seçimi
      </h3>
      <p className={isCustomerSelectionFocusScreen ? 'mt-3 text-lg text-brand-700 md:text-2xl' : 'mt-1 text-sm text-brand-700'}>
        Müşteriyi seçin veya yeni müşteri oluşturun.
      </p>

      <div className={`mt-4 flex ${isCustomerSelectionFocusScreen ? 'flex-wrap gap-3' : 'gap-2'}`}>
        <Button
          variant={customerMode === 'existing' ? 'primary' : 'ghost'}
          onClick={() => onSetCustomerMode('existing')}
          className={isCustomerSelectionFocusScreen ? 'h-12 px-6 text-lg md:h-14 md:text-xl' : ''}
        >
          Mevcut Müşteri
        </Button>
        <Button
          variant={customerMode === 'new' ? 'primary' : 'ghost'}
          onClick={() => onSetCustomerMode('new')}
          className={isCustomerSelectionFocusScreen ? 'h-12 px-6 text-lg md:h-14 md:text-xl' : ''}
        >
          Yeni Müşteri
        </Button>
      </div>

      {tradeSide === 'sell_to_customer' && !sessionExists && (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-900">Satış Yöntemi</p>
          <p className="mt-1 text-xs text-brand-700">
            Envanterden hazır ürün satabilir veya manuel satış kaydı açabilirsiniz.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant={saleMode === 'inventory' ? 'primary' : 'ghost'}
              onClick={() => onSetSaleMode('inventory')}
            >
              Envanterden Satış
            </Button>
            <Button
              variant={saleMode === 'manual' ? 'primary' : 'ghost'}
              onClick={() => onSetSaleMode('manual')}
            >
              Manuel Satış
            </Button>
          </div>
        </div>
      )}

      {customerMode === 'existing' ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-brand-200 bg-white p-3 md:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className={`font-semibold text-brand-900 ${isCustomerSelectionFocusScreen ? 'text-lg md:text-xl' : 'text-sm'}`}>
                Hızlı Seçim
              </p>
              <Button variant="ghost" onClick={() => void onLoadRecentCustomers()} disabled={loadingCustomers || searching}>
                Listeyi Yenile
              </Button>
            </div>
            {quickSelectCandidates.length > 0 ? (
              <>
                <div ref={quickSelectRowRef} className="w-full overflow-hidden">
                  <div className="flex flex-nowrap gap-2">
                    {quickSelectCandidates.slice(0, quickSelectVisibleCount).map((customer) => (
                      <button
                        key={`quick-customer-${customer.id}`}
                        type="button"
                        onClick={() => onSelectSuggestedCustomer(customer)}
                        className={`shrink-0 rounded-2xl border shadow-sm transition ${
                          isCustomerSelectionFocusScreen ? 'px-4 py-2.5 text-sm md:text-base' : 'px-3 py-1.5 text-xs'
                        } ${
                          selectedCustomerId === customer.id
                            ? 'border-brand-500 bg-brand-100 text-brand-900'
                            : 'border-brand-200 bg-brand-50/50 text-brand-800 hover:bg-brand-100'
                        }`}
                      >
                        {customer.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div ref={quickSelectMeasureRef} className="pointer-events-none absolute -left-[9999px] top-0 h-0 overflow-hidden opacity-0">
                  <div className="flex flex-nowrap gap-2">
                    {quickSelectCandidates.map((customer) => (
                      <span
                        key={`measure-customer-${customer.id}`}
                        className={`shrink-0 rounded-2xl border shadow-sm ${
                          isCustomerSelectionFocusScreen ? 'px-4 py-2.5 text-sm md:text-base' : 'px-3 py-1.5 text-xs'
                        }`}
                      >
                        {customer.name}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className={`text-brand-600 ${isCustomerSelectionFocusScreen ? 'text-sm md:text-base' : 'text-xs'}`}>
                Kayıtlı müşteri bulunamadı.
              </p>
            )}
          </div>

          <div className="relative">
            <Input
              className={customerFocusFieldClass}
              value={customerQuery}
              onChange={(event) => {
                onSetCustomerQuery(event.target.value);
                onSetShowCustomerSuggestions(true);
              }}
              onFocus={() => {
                if (customerSuggestions.length > 0) onSetShowCustomerSuggestions(true);
              }}
              onBlur={() => {
                window.setTimeout(() => onSetShowCustomerSuggestions(false), 120);
              }}
              onKeyDown={(event) => {
                if (!showCustomerSuggestions || !customerSuggestions.length) {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void onSearchCustomers();
                  }
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  onSetActiveCustomerSuggestionIndex((prev) =>
                    Math.min(prev + 1, customerSuggestions.length - 1),
                  );
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  onSetActiveCustomerSuggestionIndex((prev) => Math.max(prev - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const index =
                    activeCustomerSuggestionIndex >= 0 ? activeCustomerSuggestionIndex : 0;
                  const picked = customerSuggestions[index];
                  if (picked) {
                    onSelectSuggestedCustomer(picked);
                  } else {
                    void onSearchCustomers();
                  }
                } else if (event.key === 'Escape') {
                  onSetShowCustomerSuggestions(false);
                }
              }}
              placeholder="Ad, telefon, e-posta, CPR/kimlik no ile ara (min 2)"
            />
            {showCustomerSuggestions && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-brand-200 bg-white shadow-lg">
                {loadingCustomerSuggestions ? (
                  <p className={`px-3 py-2 ${isCustomerSelectionFocusScreen ? 'text-base' : 'text-sm'} text-brand-600`}>Aranıyor...</p>
                ) : customerSuggestions.length ? (
                  customerSuggestions.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onSelectSuggestedCustomer(item);
                      }}
                      className={`block w-full px-3 py-2 text-left ${isCustomerSelectionFocusScreen ? 'text-base md:text-lg' : 'text-sm'} ${
                        index === activeCustomerSuggestionIndex
                          ? 'bg-brand-100 text-brand-900'
                          : 'text-brand-800 hover:bg-brand-50'
                      }`}
                    >
                      <span className="font-medium">{item.name}</span>
                      <span className={`block ${isCustomerSelectionFocusScreen ? 'text-sm' : 'text-xs'} text-brand-600`}>
                        {item.phone || item.email || '-'}
                        {item.cpr_number_masked ? ` · CPR: ${item.cpr_number_masked}` : ''}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className={`px-3 py-2 ${isCustomerSelectionFocusScreen ? 'text-base' : 'text-sm'} text-brand-600`}>Öneri bulunamadı.</p>
                )}
              </div>
            )}
          </div>

          {selectedCustomer && (
            <div className={`rounded-lg border border-brand-200 bg-brand-50 p-3 text-brand-800 ${isCustomerSelectionFocusScreen ? 'text-base md:text-lg' : 'text-sm'}`}>
              <p>
                <strong>Müşteri:</strong> {selectedCustomer.name}
              </p>
              <p>
                <strong>Telefon:</strong> {selectedCustomer.phone || '-'}
              </p>
              <p>
                <strong>Postnr:</strong> {selectedCustomer.postal_code || '-'}
              </p>
              <p>
                <strong>Kimlik Tipi:</strong> {labelIdentityDocType(selectedCustomer.identity_doc_type)}
              </p>
              <div className="mt-2">
                <Button variant="ghost" onClick={onClearSelectedCustomer}>
                  Seçimi Temizle
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className={`mt-4 grid gap-3 md:grid-cols-2 ${isCustomerSelectionFocusScreen ? 'md:gap-4' : ''}`}>
          <Input
            className={customerFocusFieldClass}
            placeholder="Ad Soyad *"
            value={newCustomer.name}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                name: event.target.value,
              }))
            }
          />
          <Input
            placeholder="Telefon * (örn: +45 22 33 44 55)"
            className={`${customerFocusFieldClass} ${
              !isNewCustomerPhoneValid ? 'border-red-500 focus-visible:ring-red-300' : ''
            }`}
            value={newCustomer.phone}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                phone: event.target.value,
              }))
            }
          />
          <Input
            placeholder="E-posta"
            className={`${customerFocusFieldClass} ${
              !isNewCustomerEmailValid ? 'border-red-500 focus-visible:ring-red-300' : ''
            }`}
            value={newCustomer.email}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                email: event.target.value,
              }))
            }
          />
          <Input
            placeholder="CPR * (örn: 120485-1234)"
            className={`${customerFocusFieldClass} ${
              !isNewCustomerCprValid ? 'border-red-500 focus-visible:ring-red-300' : ''
            }`}
            value={newCustomer.cpr_number}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                cpr_number: event.target.value,
              }))
            }
          />
          <Input
            className={`md:col-span-2 ${customerFocusFieldClass}`}
            placeholder="Adres"
            value={newCustomer.address}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                address: event.target.value,
              }))
            }
          />
          <Input
            placeholder="Postnr. (örn: 2500)"
            className={customerFocusFieldClass}
            value={newCustomer.postal_code}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                postal_code: event.target.value,
              }))
            }
          />
          <Select
            className={customerFocusFieldClass}
            value={newCustomer.identity_doc_type}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                identity_doc_type: event.target.value as IdentityDocType | '',
              }))
            }
          >
            <option value="">Kimlik belgesi tipi</option>
            {identityDocOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Kimlik Belge No *"
            className={`${customerFocusFieldClass} ${
              !isNewCustomerIdentityValid ? 'border-red-500 focus-visible:ring-red-300' : ''
            }`}
            value={newCustomer.identity_doc_number}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                identity_doc_number: event.target.value,
              }))
            }
          />
          <Input
            className={customerFocusFieldClass}
            placeholder="Belge ülkesi (örn: DK)"
            value={newCustomer.identity_doc_country}
            onChange={(event) =>
              onSetNewCustomer((state) => ({
                ...state,
                identity_doc_country: event.target.value,
              }))
            }
          />
          <div className={`md:col-span-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-brand-800 ${isCustomerSelectionFocusScreen ? 'text-sm md:text-base' : 'text-xs'}`}>
            <p className="font-semibold text-brand-900">Kimlik Doğrulama Kontrolü</p>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
              <p>{newCustomerName ? 'Tamam' : 'Bekliyor'} · Ad Soyad</p>
              <p>{newCustomerPhone && isNewCustomerPhoneValid ? 'Tamam' : 'Bekliyor'} · Telefon (7-15 rakam)</p>
              <p>{newCustomerCpr && isNewCustomerCprValid ? 'Tamam' : 'Bekliyor'} · CPR (10 rakam)</p>
              <p>{newCustomerIdentity && isNewCustomerIdentityValid ? 'Tamam' : 'Bekliyor'} · Kimlik Belge No</p>
              <p>{isNewCustomerEmailValid ? 'Tamam' : 'Hatalı'} · E-posta (opsiyonel)</p>
            </div>
            <p className="mt-2 text-[11px] text-brand-700">
              Örnek: Telefon `+45 22 33 44 55`, CPR `120485-1234`
            </p>
          </div>
        </div>
      )}

      <div className={`mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-brand-800 ${isCustomerSelectionFocusScreen ? 'text-sm md:text-base' : 'text-xs'}`}>
        <p className="font-semibold text-brand-900">Afregningsbilag Müşteri Alanları (Önizleme)</p>
        <div className="mt-2 grid gap-1 md:grid-cols-2">
          <p>
            C16 · Navn: <strong>{customerMode === 'existing' ? selectedCustomer?.name || '-' : newCustomer.name.trim() || '-'}</strong>
          </p>
          <p>
            F16 · CPR nr.: <strong>{customerMode === 'existing' ? selectedCustomer?.cpr_number_masked || '-' : newCustomer.cpr_number.trim() || '-'}</strong>
          </p>
          <p>
            C17 · Adresse: <strong>{customerMode === 'existing' ? selectedCustomer?.address || '-' : newCustomer.address.trim() || '-'}</strong>
          </p>
          <p>
            C18 · Postnr.: <strong>{customerMode === 'existing' ? selectedCustomer?.postal_code || '-' : newCustomerPostalCode || '-'}</strong>
          </p>
          <p>
            F18 · Tlf.: <strong>{customerMode === 'existing' ? selectedCustomer?.phone || '-' : newCustomer.phone.trim() || '-'}</strong>
          </p>
          <p>
            F19 · E-mail: <strong>{customerMode === 'existing' ? selectedCustomer?.email || '-' : newCustomer.email.trim() || '-'}</strong>
          </p>
          <p className="md:col-span-2">
            F17 · Kørekort/Pas: <strong>{customerMode === 'existing'
              ? `${labelIdentityDocType(selectedCustomer?.identity_doc_type)} ${selectedCustomer?.identity_doc_number_masked || ''}`.trim() || '-'
              : `${labelIdentityDocType(newCustomer.identity_doc_type || null)} ${newCustomer.identity_doc_number.trim()}`.trim() || '-'}</strong>
          </p>
        </div>
      </div>

      <div className={`mt-6 ${isCustomerSelectionFocusScreen ? 'flex flex-col items-center gap-3' : ''}`}>
        <Button
          onClick={() => void onCreateSession()}
          disabled={busy || !canStartSession}
          className={isCustomerSelectionFocusScreen ? 'h-14 min-w-[300px] px-8 text-lg md:h-16 md:min-w-[420px] md:text-2xl' : ''}
        >
          POS Oturumu Başlat
        </Button>
        <p className={isCustomerSelectionFocusScreen ? 'text-sm text-brand-700 md:text-base' : 'mt-2 text-xs text-brand-700'}>
          {customerMode === 'existing'
            ? selectedCustomerId
              ? 'Hazır: Seçilen müşteri ile oturum açabilirsiniz.'
              : 'Oturum için önce bir müşteri seçin.'
            : isNewCustomerReady
              ? 'Hazır: Yeni müşteri bilgileri tamam.'
              : `Eksik/Hatalı: ${newCustomerValidationIssues[0] || 'Yeni müşteri bilgilerini kontrol edin.'}`}
        </p>
      </div>
    </div>
  );
}
