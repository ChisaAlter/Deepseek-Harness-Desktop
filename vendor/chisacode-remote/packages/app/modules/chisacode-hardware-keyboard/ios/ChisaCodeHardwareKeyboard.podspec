require 'json'

Pod::Spec.new do |s|
  s.name           = 'ChisaCodeHardwareKeyboard'
  s.version        = '0.1.0'
  s.summary        = 'Hardware keyboard shortcuts for ChisaCode'
  s.description    = 'Hardware keyboard shortcuts for ChisaCode'
  s.license        = 'AGPL-3.0-or-later'
  s.author         = 'ChisaCode'
  s.homepage       = 'https://chisacode.sh'
  s.platforms      = { :ios => '13.4' }
  s.swift_version  = '5.4'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
