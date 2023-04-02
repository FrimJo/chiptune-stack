param name string
param location string = resourceGroup().location
param tags object = {}

param containerAppsEnvironmentName string = ''
param containerName string = 'main'
param containerRegistryName string = ''
param env array = []
param external bool = true
param imageName string
param keyVaultName string = ''
param managedIdentity bool = !empty(keyVaultName)
param targetPort int = 80
param useIdentityProviders bool = false

@description('CPU cores allocated to a single container instance, e.g. 0.5')
param containerCpuCoreCount string = '0.5'

@description('Memory allocated to a single container instance, e.g. 1Gi')
param containerMemory string = '1.0Gi'

@secure()
param googleClientId string

@secure()
param googleClientSecret string

resource app 'Microsoft.App/containerApps@2022-03-01' = {
  name: name
  location: location
  tags: tags
  identity: { type: managedIdentity ? 'SystemAssigned' : 'None' }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'single'
      ingress: {
        external: external
        targetPort: targetPort
        transport: 'auto'
      }
      secrets: [
        {
          name: 'google-client-secret'
          value: googleClientSecret
        }
        {
          name: 'registry-password'
          value: containerRegistry.listCredentials().passwords[0].value
        }
      ]
      registries: [
        {
          server: '${containerRegistry.name}.azurecr.io'
          username: containerRegistry.name
          passwordSecretRef: 'registry-password'
        }
      ]
    }
    template: {
      containers: [
        {
          image: imageName
          name: containerName
          env: env
          resources: {
            cpu: json(containerCpuCoreCount)
            memory: containerMemory
          }
        }
      ]
    }
  }
}

// Configuration
resource authSettings 'Microsoft.App/containerApps/authConfigs@2022-10-01' = {
  name: 'current'
  parent: app
  properties: {
    globalValidation: {
      excludedPaths: [ '/', '/join', '/login' ]
      redirectToProvider: 'google'
      unauthenticatedClientAction: 'RedirectToLoginPage'
    }
    httpSettings: {
      requireHttps: true
      routes: {
        apiPrefix: ''
      }
    }
    identityProviders: {
      google: {
        enabled: true
        login: {
          scopes: []
        }
        registration: {
          clientId: googleClientId
          clientSecretSettingName: 'google-client-secret'
        }
        validation: {
          allowedAudiences: []
        }
      }
    }
    login: {
      allowedExternalRedirectUrls: []
      cookieExpiration: {
        convention: 'IdentityProviderDerived'
      }
      routes: {
        logoutEndpoint: '/logout'
      }
    }
    platform: {
      enabled: useIdentityProviders
    }
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2022-03-01' existing = {
  name: containerAppsEnvironmentName
}

// 2022-02-01-preview needed for anonymousPullEnabled
resource containerRegistry 'Microsoft.ContainerRegistry/registries@2022-02-01-preview' existing = {
  name: containerRegistryName
}

output identityPrincipalId string = managedIdentity ? app.identity.principalId : ''
output imageName string = imageName
output name string = app.name
output uri string = 'https://${app.properties.configuration.ingress.fqdn}'
