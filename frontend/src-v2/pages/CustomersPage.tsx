import { CustomersPage as MakeCustomersPage } from '@/make/customers/CustomersPage';
import { useCustomersMakeState } from '@/make/customers/useCustomersMakeState';

export function CustomersPage() {
  const state = useCustomersMakeState();
  return <MakeCustomersPage {...state} />;
}
