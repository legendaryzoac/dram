import * as path from 'node:path'
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'

const DOMAIN = 'dram.zackwithers.com'
const ZONE_ID = 'Z0874780F3FVBPDZKEOR'
const ZONE_NAME = 'zackwithers.com'
const GITHUB_REPO = 'legendaryzoac/dram'

// Bedrock model ids (verified against AWS docs 2026-07). The Haiku id is the US
// cross-region *inference profile* — newer Claude models are on-demand only via
// a profile, which fans requests out to us-east-1/us-east-2/us-west-2, so IAM
// must allow InvokeModel on the profile AND the underlying foundation models in
// each of those regions.
const TITAN_MODEL = 'amazon.titan-embed-text-v2:0'
const HAIKU_PROFILE = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
const HAIKU_MODEL = 'anthropic.claude-haiku-4-5-20251001-v1:0'
const BEDROCK_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2']

export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: ZONE_ID,
      zoneName: ZONE_NAME,
    })

    // CloudFront requires the cert in us-east-1; the whole stack lives there.
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: DOMAIN,
      validation: acm.CertificateValidation.fromDns(zone),
    })

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    })

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      domainNames: [DOMAIN],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      // SPA routing: unknown paths fall through to index.html
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(1),
        },
      ],
    })

    new route53.ARecord(this, 'AliasRecord', {
      zone,
      recordName: 'dram',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    })

    new route53.AaaaRecord(this, 'AliasRecordIpv6', {
      zone,
      recordName: 'dram',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    })

    // ---- identity ----

    // Invite-only: accounts are created with admin-create-user, never self-signup.
    const userPool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    })

    const webClient = userPool.addClient('WebClient', {
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      refreshTokenValidity: Duration.days(60),
    })

    // ---- data ----

    // Single table: bottles (PK=BOTTLE#<id> SK=META) + their notes
    // (SK=NOTE#<ts>#<id>). One Query by PK returns a bottle and all its notes.
    // GET /bottles is a filtered Scan (personal scale) — no GSI needed.
    const table = new dynamodb.Table(this, 'DataTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    })

    // ---- API Lambda ----

    const apiFn = new NodejsFunction(this, 'ApiFn', {
      entry: path.join(__dirname, '../../api/src/handler.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      // Recommendations may make a synchronous Bedrock (embed + Haiku) call;
      // give it headroom over the default.
      timeout: Duration.seconds(20),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        TABLE_NAME: table.tableName,
      },
    })
    table.grantReadWriteData(apiFn)

    // Bedrock: InvokeModel on Titan (embeddings) + the Haiku inference profile
    // and its underlying foundation models across the profile's regions.
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          // Titan embeddings, in-region (this stack is us-east-1).
          `arn:aws:bedrock:${this.region}::foundation-model/${TITAN_MODEL}`,
          // Haiku inference profile (account-scoped resource).
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${HAIKU_PROFILE}`,
          // The foundation models the profile routes to, in each region.
          ...BEDROCK_REGIONS.map(
            (r) => `arn:aws:bedrock:${r}::foundation-model/${HAIKU_MODEL}`,
          ),
        ],
      }),
    )

    // ---- HTTP API with a Cognito JWT authorizer ----

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      // CORS is enforced by the API too; the browser app is same-domain-ish but
      // served from CloudFront, and localhost covers Vite dev.
      corsPreflight: {
        allowOrigins: [
          `https://${DOMAIN}`,
          'http://localhost:5173',
          'http://localhost:4173',
        ],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    })

    const integration = new HttpLambdaIntegration('ApiIntegration', apiFn)

    // Cognito access tokens carry client_id in `client_id` (not `aud`); the
    // JWT authorizer validates issuer + audience against the user pool client.
    const authorizer = new HttpJwtAuthorizer(
      'JwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [webClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      },
    )

    // Public reads.
    for (const [method, route] of [
      [apigwv2.HttpMethod.GET, '/health'],
      [apigwv2.HttpMethod.GET, '/bottles'],
      [apigwv2.HttpMethod.GET, '/bottles/{id}'],
      [apigwv2.HttpMethod.GET, '/bottles/{id}/recommendations'],
    ] as const) {
      httpApi.addRoutes({ path: route, methods: [method], integration })
    }

    // Authed writes (JWT authorizer).
    for (const [method, route] of [
      [apigwv2.HttpMethod.POST, '/bottles'],
      [apigwv2.HttpMethod.PUT, '/bottles/{id}'],
      [apigwv2.HttpMethod.DELETE, '/bottles/{id}'],
      [apigwv2.HttpMethod.POST, '/bottles/{id}/notes'],
    ] as const) {
      httpApi.addRoutes({ path: route, methods: [method], integration, authorizer })
    }

    // ---- GitHub-OIDC deploy role (web CI only) ----

    // Deploy role assumed by GitHub Actions via the account's existing OIDC
    // provider; scoped to pushes on this repo's main branch. Ships the web build.
    const ciRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'dram-github-deploy',
      assumedBy: new iam.WebIdentityPrincipal(
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_REPO}:ref:refs/heads/main`,
          },
        },
      ),
    })
    siteBucket.grantPut(ciRole)
    siteBucket.grantDelete(ciRole)
    ciRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [siteBucket.bucketArn],
      }),
    )
    distribution.grantCreateInvalidation(ciRole)

    // ---- outputs (consumed by the web build; see DEPLOYMENT.md) ----
    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId })
    new CfnOutput(this, 'WebClientId', { value: webClient.userPoolClientId })
    new CfnOutput(this, 'TableName', { value: table.tableName })
    new CfnOutput(this, 'BucketName', { value: siteBucket.bucketName })
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId })
    new CfnOutput(this, 'CiRoleArn', { value: ciRole.roleArn })
    new CfnOutput(this, 'Url', { value: `https://${DOMAIN}` })
  }
}
