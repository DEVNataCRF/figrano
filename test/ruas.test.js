'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixStreetName, matchStreet, cityNeighborhoods, streetNames } = require('../src/main/robo/ruas');

test('base de Guaçuí carregada (OpenStreetMap)', () => {
  assert.ok(streetNames().length > 200);
  assert.ok(cityNeighborhoods().includes('Centro'));
});

test('corrige nome de rua escrito ou transcrito errado', () => {
  assert.match(fixStreetName('Rua Venida, Físcula Cerda de Aguiar, 423, centro'), /^Avenida Governador (Francisco )?Lacerda de Aguiar, 423, centro$/);
  assert.equal(fixStreetName('rua joao golart, 10'), 'Rua João Goulart, 10');
  assert.equal(fixStreetName('Rua Marechal Deodor 50'), 'Rua Marechal Deodoro 50');
});

test('não mexe no que já está certo nem no que não conhece', () => {
  assert.equal(fixStreetName('Rua Avenida Francisco Lacerda de Aguiar, 423, Centro'), 'Rua Avenida Francisco Lacerda de Aguiar, 423, Centro');
  assert.equal(fixStreetName('Rua das Flores 120, centro'), 'Rua das Flores 120, centro');
  assert.equal(fixStreetName('Sítio do Zé, estrada de terra'), 'Sítio do Zé, estrada de terra');
  assert.equal(matchStreet('rua'), null);
});
