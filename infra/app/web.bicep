param name string
param location string = resourceGroup().location
param tags object = {}

param applicationInsightsName string
param containerAppsEnvironmentName string
param containerRegistryName string
param imageName string = ''
param serviceName string = 'web'
param databaseServerHost string
param databaseName string
param databaseUsername string
param useIdentityProviders bool = false

@secure()
param databasePassword string

@secure()
param sessionSecret string

@secure()
param googleClientId string = ''

@secure()
param googleClientSecret string = ''

module app '../core/host/container-app.bicep' = {
  name: '${serviceName}-container-app-module'
  params: {
    name: name
    location: location
    tags: union(tags, { 'azd-service-name': serviceName })
    containerAppsEnvironmentName: containerAppsEnvironmentName
    containerRegistryName: containerRegistryName
    googleClientId: googleClientId
    googleClientSecret: googleClientSecret
    useIdentityProviders: useIdentityProviders
    env: [
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        value: applicationInsights.properties.ConnectionString
      }
      {
        name: 'DATABASE_CONNECTION_STRING'
        value: 'postgresql://${databaseUsername}:${databasePassword}@${databaseServerHost}/${databaseName}'
      }
      {
        name: 'SESSION_SECRET'
        value: sessionSecret
      }
      {
        name: 'PORT'
        value: '80'
      }
      {
        name: 'NODE_ENV'
        value: 'production'
      }
    ]
    imageName: !empty(imageName) ? imageName : 'nginx:latest'
    targetPort: 80
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: applicationInsightsName
}

output SERVICE_WEB_IDENTITY_PRINCIPAL_ID string = app.outputs.identityPrincipalId
output SERVICE_WEB_NAME string = app.outputs.name
output SERVICE_WEB_URI string = app.outputs.uri
output SERVICE_WEB_IMAGE_NAME string = app.outputs.imageName
