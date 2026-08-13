import { CustomersPage as MakeCustomersPage } from '@/make/customers/CustomersPage';
import { useCustomersMakeState } from '@/make/customers/useCustomersMakeState';
import { createModernCustomersViewModel } from '@/modern/adapters';
import { ModernCustomersModule } from '@/modern/modules';
import { useUiVariant } from '@/ui-variants';
import { DockableCustomerNotesPanel } from '@/components/DockableCustomerNotesPanel';

export function CustomersPage() {
  const state = useCustomersMakeState();
  const { variant } = useUiVariant();
  return variant === 'modern' ? <ModernCustomersModule viewModel={createModernCustomersViewModel(state)} /> : <><MakeCustomersPage {...state} />{state.selectedCustomer ? <DockableCustomerNotesPanel key={state.selectedCustomer.id} customerId={state.selectedCustomer.id} customerName={state.selectedCustomer.name} manage /> : null}</>;
}
