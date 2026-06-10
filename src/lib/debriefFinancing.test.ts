import { describe, it, expect } from 'vitest'
import {
  computeAcompteAmount,
  joinKits,
  splitKits,
  PAYMENT_METHOD_CONFIG,
} from './debriefFinancing'

describe('computeAcompteAmount', () => {
  it('calcule le pourcentage du devis TTC', () => {
    expect(computeAcompteAmount('30000', 40)).toBe(12000)
    expect(computeAcompteAmount('30000', 30)).toBe(9000)
  })
  it('gère la virgule décimale', () => {
    expect(computeAcompteAmount('1000,50', 20)).toBeCloseTo(200.1)
  })
  it('retourne null si montant ou pourcentage invalide', () => {
    expect(computeAcompteAmount('', 40)).toBeNull()
    expect(computeAcompteAmount('abc', 40)).toBeNull()
    expect(computeAcompteAmount('30000', null)).toBeNull()
  })
})

describe('kits join/split', () => {
  it('joint avec le séparateur', () => {
    expect(joinKits(['8 PV', 'batterie 5 kWh'])).toBe('8 PV · batterie 5 kWh')
  })
  it('découpe sur le séparateur en nettoyant', () => {
    expect(splitKits('8 PV · batterie 5 kWh')).toEqual(['8 PV', 'batterie 5 kWh'])
    expect(splitKits('')).toEqual([])
    expect(splitKits(null)).toEqual([])
  })
})

describe('PAYMENT_METHOD_CONFIG', () => {
  it('définit les 4 méthodes avec leurs options', () => {
    expect(PAYMENT_METHOD_CONFIG.comptant.acomptePercents).toEqual([40, 30])
    expect(PAYMENT_METHOD_CONFIG.financement.acomptePercents).toEqual([30, 20])
    expect(PAYMENT_METHOD_CONFIG.paiement_10x.acomptePercents).toEqual([30])
    expect(PAYMENT_METHOD_CONFIG.paiement_12x.acomptePercents).toEqual([30])
    expect(PAYMENT_METHOD_CONFIG.financement.subChoice).toBe('org')
    expect(PAYMENT_METHOD_CONFIG.comptant.subChoice).toBe('method')
  })
})
