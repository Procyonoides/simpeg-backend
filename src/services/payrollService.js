// Hitung tunjangan/potongan dari salary_components untuk 1 karyawan.
// components: baris dari tabel salary_components (type: 'addition' | 'deduction')
function calculateComponents(basicSalary, components) {
  let totalAllowance = 0;
  let totalDeduction = 0;
  const breakdown = [];

  for (const c of components) {
    const rawAmount = parseFloat(c.amount) || 0;
    const value = c.is_percent ? (basicSalary * rawAmount) / 100 : rawAmount;

    if (c.type === 'addition') totalAllowance += value;
    else if (c.type === 'deduction') totalDeduction += value;

    breakdown.push({
      component_name: c.name,
      type: c.type,
      amount: Math.round(value)
    });
  }

  const grossSalary = basicSalary + totalAllowance;
  const netSalary = grossSalary - totalDeduction;

  return {
    totalAllowance: Math.round(totalAllowance),
    totalDeduction: Math.round(totalDeduction),
    grossSalary: Math.round(grossSalary),
    netSalary: Math.round(netSalary),
    breakdown
  };
}

module.exports = { calculateComponents };
