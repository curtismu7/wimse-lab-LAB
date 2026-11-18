// diagram-studio/1 data: loaded by name, never hand-built nodes in the component.
export const diagram = {
  id: 'wimse-chain',
  format: 'diagram-studio/1',
  nodes: [
    { id: 'issuer', label: 'Issuer / Credential Service', sub: 'trust domain corp.example.com' },
    { id: 'gateway', label: 'Gateway', sub: 'wimse://corp.example.com/gateway' },
    { id: 'orders', label: 'Orders', sub: 'wimse://corp.example.com/orders' },
    { id: 'billing', label: 'Billing', sub: 'wimse://corp.example.com/billing' },
    { id: 'txn', label: 'Context service', sub: 'Txn-Token (Alice)' },
  ],
  edges: [
    { id: 'e1', from: 'issuer', to: 'gateway', label: '(1) WIT' },
    { id: 'e2', from: 'gateway', to: 'orders', label: '(2) WIT + WPT + Txn' },
    { id: 'e3', from: 'orders', to: 'billing', label: '(3) WIT + WPT (binds Txn)' },
    { id: 'e4', from: 'txn', to: 'gateway', label: 'Txn-Token' },
  ],
};
