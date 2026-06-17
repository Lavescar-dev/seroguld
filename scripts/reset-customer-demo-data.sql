\set ON_ERROR_STOP on
\pset footer off

\echo 'BEFORE'
select 'customers' as area, count(*) as count from users where role = 'customer'
union all select 'customer_identity_documents', count(*) from customer_identity_documents
union all select 'customer_activity_events', count(*) from customer_activity_events
union all select 'pos_sessions', count(*) from pos_sessions
union all select 'pos_documents', count(*) from pos_documents
union all select 'document_artifacts', count(*) from document_artifacts
union all select 'transactions', count(*) from transactions
union all select 'gdpr_requests', count(*) from gdpr_requests
union all select 'woocommerce_sync_log', count(*) from woocommerce_sync_log
union all select 'products_with_customer_links', count(*) from products where seller_customer_id is not null or buyer_customer_id is not null;

begin;
delete from woocommerce_sync_log;
delete from pos_session_product_links;
delete from transaction_lines;
delete from transactions;
delete from pos_document_audit;
delete from document_artifacts;
delete from pos_documents;
delete from pos_session_lines;
delete from customer_activity_events;
delete from pos_sessions;
delete from gdpr_request_events;
delete from gdpr_jobs;
delete from gdpr_requests;
delete from customer_identity_documents;
update products
set seller_customer_id = null,
    buyer_customer_id = null,
    deleted_by_user_id = null
where seller_customer_id is not null
   or buyer_customer_id is not null
   or deleted_by_user_id is not null;
delete from users where role = 'customer';
delete from reference_sequences where key in ('afregnings_number', 'invoice_number');
alter sequence if exists pos_documents_sequence_no_seq restart with 1;
commit;

\echo 'AFTER'
select 'customers' as area, count(*) as count from users where role = 'customer'
union all select 'customer_identity_documents', count(*) from customer_identity_documents
union all select 'customer_activity_events', count(*) from customer_activity_events
union all select 'pos_sessions', count(*) from pos_sessions
union all select 'pos_documents', count(*) from pos_documents
union all select 'document_artifacts', count(*) from document_artifacts
union all select 'transactions', count(*) from transactions
union all select 'gdpr_requests', count(*) from gdpr_requests
union all select 'woocommerce_sync_log', count(*) from woocommerce_sync_log
union all select 'products_with_customer_links', count(*) from products where seller_customer_id is not null or buyer_customer_id is not null;
